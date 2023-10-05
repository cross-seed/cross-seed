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
	save_path?: string;
}

export default class Deluge implements TorrentClient {
	private delugeCookie = null;
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
				"you need to define a password in the delugeRpcUrl. (e.g. http://:<PASSWORD>@localhost:8112)"
			);
		}
		const response = await this.call("auth.login", [password], 0);
		if (!response.result) {
			throw new CrossSeedError(
				`reached deluge, but failed to authenticate: ${href}`
			);
		}
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 */
	private async call(method: string, params: object, retries = 1) {
		const { delugeRpcUrl } = getRuntimeConfig();
		const { href } = extractCredentialsFromUrl(delugeRpcUrl).unwrapOrThrow(
			new CrossSeedError("delugeRpcUrl must be percent-encoded")
		);
		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeResponse;
		try {
			response = await fetch(href, {
				body: JSON.stringify({
					...{ method: method, params: params },
					id: Math.floor(Math.random() * 1000000),
				}),
				method: "POST",
				headers: headers,
			});
			json = (await response.json()) as DelugeResponse;
		} catch (NetworkError) {
			throw new CrossSeedError(
				`failed to establish a connection to deluge: ${href}`
			);
		}
		if (json?.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			this.delugeCookie = null;
			await this.authenticate();
			return this.call(method, params, 0);
		}
		this.handleResponseHeaders(response.headers);
		return json;
	}

	/**
	 * parses the set-cookie header and updates stored value
	 */
	private handleResponseHeaders(headers: Headers) {
		if (headers?.has("Set-Cookie")) {
			this.delugeCookie = headers.get("Set-Cookie").split(";")[0];
			return true;
		}
		return false;
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
		let torrentInfo;
		if (searchee.infoHash) {
			torrentInfo = await this.getTorrentInfo(searchee);
			if (!torrentInfo.complete) {
				return InjectionResult.TORRENT_NOT_COMPLETE;
			}
		}

		const params = this.formatData(
			`${newTorrent.name}.cross-seed.torrent`,
			newTorrent.encode().toString("base64"),
			path ? path : torrentInfo.save_path
		);
		const addResult = (await this.call(
			"core.add_torrent_file",
			params
		)) as DelugeResponse;
		if (addResult?.result) {
			if (searchee.infoHash) {
				await this.setLabel(newTorrent.infoHash, this.delugeLabel);
			} else {
				const { dataCategory } = getRuntimeConfig();
				await this.setLabel(newTorrent.infoHash, dataCategory);
			}
			return InjectionResult.SUCCESS;
		} else if (addResult?.error?.message?.includes("already")) {
			return InjectionResult.ALREADY_EXISTS;
		} else if (addResult?.error?.message) {
			logger.debug({
				label: Label.DELUGE,
				message: `injection failed: ${addResult.error.message}`,
			});
			return InjectionResult.FAILURE;
		}
	}

	/**
	 * formats the json for rpc calls to inject
	 */
	private formatData(filename: string, filedump: string, path: string) {
		return [
			filename,
			filedump,
			{
				add_paused: false,
				seed_mode: getRuntimeConfig().skipRecheck,
				download_location: path,
			},
		];
	}

	/**
	 * returns information needed to complete/validate injection
	 */
	private async getTorrentInfo(searchee: Searchee): Promise<TorrentInfo> {
		try {
			const params = [
				["state", "progress", "save_path"],
				{ hash: searchee.infoHash },
			];

			const response = await this.call("web.update_ui", params);
			const completedTorrent =
				response?.result?.torrents?.[searchee.infoHash]?.state ===
					"Seeding" ||
				response?.result?.torrents?.[searchee.infoHash]?.progress ===
					100;
			return {
				complete: completedTorrent,
				save_path: completedTorrent
					? response?.result?.torrents?.[searchee.infoHash]?.save_path
					: undefined,
			} as TorrentInfo;
		} catch (e) {
			logger.debug({
				label: Label.DELUGE,
				message: `failed to fetch torrent data from deluge: ${searchee.name} - ${searchee.infoHash}`,
			});
		}
		return { complete: false } as TorrentInfo;
	}
}
