import { InjectionResult } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";
import { extractCredentialsFromUrl } from "../utils.js";
import fetch, { Headers, Response } from "node-fetch";

interface DelugeResponse {
	error?: {
		message?: string;
		code?: DelugeErrorCode;
	};
	result?: string | boolean;
}
enum DelugeErrorCode {
	NO_AUTH = 1,
	BAD_METHOD = 2,
	CALL_ERR = 3,
	RPC_FAIL = 4,
	BAD_JSON = 5,
}
interface TorrentInfo {
	complete: boolean;
	save_path: string;
	label?: string;
}

export default class Deluge implements TorrentClient {
	private delugeCookie: string | null = null;
	private delugeLabel = "cross-seed";
	private isLabelEnabled: boolean;

	/**
	 * validates the login and host for deluge webui
	 */
	async validateConfig(): Promise<void> {
		await this.authenticate();
		this.isLabelEnabled = await this.labelEnabled();
	}

	/**
	 * connects and authenticates to the webui
	 */
	private async authenticate(): Promise<void> {
		const { delugeRpcUrl } = getRuntimeConfig();
		const { href, password } = extractCredentialsFromUrl(
			delugeRpcUrl
		).unwrapOrThrow(
			new CrossSeedError("delugeRpcUrl must be percent-encoded")
		);
		if (!password) {
			throw new CrossSeedError(
				"You need to define a password in the delugeRpcUrl. (e.g. http://:<PASSWORD>@localhost:8112)"
			);
		}
		try {
			const authResponse = await this.call("auth.login", [password], 0);
			if (!authResponse.result) {
				throw new CrossSeedError(
					`Reached Deluge, but failed to authenticate: ${href}`
				);
			}
		} catch (networkError) {
			throw new CrossSeedError(networkError);
		}
		const connectedResponse = await this.call("web.connected", [], 0);

		if (!connectedResponse.result) {
			logger.warn(
				"Deluge WebUI disconnected from daemon...attempting to reconnect."
			);
			const webuiHostList = await this.call("web.get_hosts", [], 0);
			const connectResponse = await this.call(
				"web.connect",
				[webuiHostList.result[0][0]],
				0
			);
			if (connectResponse) {
				logger.info("Deluge WebUI connected to the daemon.");
			} else {
				throw new CrossSeedError(
					"Unable to connect WebUI to Deluge daemon. Connect to the WebUI to resolve this."
				);
			}
		}
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 */
	private async call(method: string, params: object, retries = 1) {
		const { delugeRpcUrl } = getRuntimeConfig();
		const { href } =
			extractCredentialsFromUrl(delugeRpcUrl).unwrapOrThrow();
		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeResponse;
		try {
			response = await fetch(href, {
				body: JSON.stringify({
					...{ method: method, params: params },
					id: Math.floor(Math.random() * 0x7fffffff),
				}),
				method: "POST",
				headers: headers,
			});
		} catch (networkError) {
			// @ts-expect-error needs es2022 target (tsconfig)
			throw new Error(`Failed to connect to Deluge at ${href}`, {
				cause: networkError,
			});
		}
		try {
			json = await (response.json() as Promise<DelugeResponse>);
		} catch (jsonParseError) {
			throw new Error(
				`Deluge method ${method} response was non-JSON ${jsonParseError}`
			);
		}
		if (json?.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			this.delugeCookie = null;
			await this.authenticate();
			if (this.delugeCookie) {
				return this.call(method, params, 0);
			} else {
				throw new Error(
					"Connection lost with Deluge. Reauthentication failed."
				);
			}
		}
		this.handleResponseHeaders(response.headers);
		return json;
	}

	/**
	 * parses the set-cookie header and updates stored value
	 */
	private handleResponseHeaders(headers: Headers) {
		this.delugeCookie = headers.get("Set-Cookie")?.split(";")[0] ?? null;
	}

	/**
	 * checks enabled plugins for "Label"
	 * returns true if successful.
	 */
	private async labelEnabled() {
		const enabledLabels = await this.call("core.get_enabled_plugins", []);
		return enabledLabels?.result?.includes?.("Label");
	}

	/**
	 * if Label plugin is loaded, adds (if necessary)
	 * and sets the label based on torrent hash.
	 */
	private async setLabel(infoHash: string, label: string): Promise<void> {
		if (this.isLabelEnabled) {
			const setResult = await this.call("label.set_torrent", [
				infoHash,
				label,
			]);
			if (setResult?.error?.code == DelugeErrorCode.RPC_FAIL) {
				await this.call("label.add", [label]);
				await this.call("label.set_torrent", [infoHash, label]);
			}
		}
	}

	/**
	 * injects a torrent into deluge client
	 */
	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		path?: string
	): Promise<InjectionResult> {
		try {
			let torrentInfo: TorrentInfo;
			const { duplicateCategories } = getRuntimeConfig();
			if (searchee.infoHash) {
				torrentInfo = await this.getTorrentInfo(searchee);
				if (!torrentInfo.complete) {
					if (
						torrentInfo.save_path == "missing" &&
						!path &&
						!searchee.path
					) {
						return InjectionResult.FAILURE;
					}
					return InjectionResult.TORRENT_NOT_COMPLETE;
				}
			}

			const params = this.formatData(
				`${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`,
				newTorrent.encode().toString("base64"),
				path ? path : torrentInfo.save_path,
				!!searchee.infoHash
			);
			const addResult = await this.call("core.add_torrent_file", params);

			if (addResult?.result) {
				const { dataCategory } = getRuntimeConfig();
				await this.setLabel(
					newTorrent.infoHash,
					searchee.path
						? dataCategory
						: torrentInfo.label
						? duplicateCategories
							? torrentInfo.label.endsWith(".cross-seed")
								? torrentInfo.label
								: `${torrentInfo.label}.cross-seed`
							: torrentInfo.label
						: this.delugeLabel
				);
				return InjectionResult.SUCCESS;
			} else if (addResult?.error?.message?.includes("already")) {
				return InjectionResult.ALREADY_EXISTS;
			} else if (addResult?.error?.message) {
				logger.debug({
					label: Label.DELUGE,
					message: `Injection failed: ${addResult.error.message}`,
				});
				return InjectionResult.FAILURE;
			}
		} catch (injectResult) {
			logger.error({
				label: Label.DELUGE,
				message: `Injection failed: ${injectResult}`,
			});
			logger.debug(injectResult);
			return InjectionResult.FAILURE;
		}
		return InjectionResult.FAILURE;
	}

	/**
	 * formats the json for rpc calls to inject
	 */
	private formatData(
		filename: string,
		filedump: string,
		path: string,
		isTorrent: boolean
	) {
		return [
			filename,
			filedump,
			{
				add_paused: isTorrent ? false : !getRuntimeConfig().skipRecheck,
				seed_mode: isTorrent ? true : getRuntimeConfig().skipRecheck,
				download_location: path,
			},
		];
	}

	/**
	 * returns information needed to complete/validate injection
	 */
	private async getTorrentInfo(searchee: Searchee): Promise<TorrentInfo> {
		try {
			let torrentLabel: string | undefined;
			const params = [
				["state", "progress", "save_path", "label"],
				{ hash: searchee.infoHash },
			];
			const response = await this.call("web.update_ui", params);
			if (response?.result?.torrents?.[searchee.infoHash] === undefined) {
				throw new Error(
					`Torrent not found in client (${searchee.infoHash})`
				);
			}
			if (
				this.isLabelEnabled &&
				response?.result?.torrents?.[searchee.infoHash]?.label
					?.length != 0
			) {
				torrentLabel =
					response?.result?.torrents?.[searchee.infoHash]?.label;
			}

			const completedTorrent =
				response?.result?.torrents?.[searchee.infoHash]?.state ===
					"Seeding" ||
				response?.result?.torrents?.[searchee.infoHash]?.progress ===
					100;
			return {
				complete: completedTorrent,
				save_path:
					response?.result?.torrents?.[searchee.infoHash]?.save_path,
				label: torrentLabel,
			};
		} catch (e) {
			logger.error({
				label: Label.DELUGE,
				message: `Failed to fetch torrent data: ${searchee.name} - (${searchee.infoHash})`,
			});
			logger.debug(e);
			return { complete: false, save_path: "missing" };
		}
	}
}
