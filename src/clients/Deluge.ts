import {
	InjectionResult,
	TORRENT_TAG,
	TORRENT_CATEGORY_SUFFIX,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";
import { extractCredentialsFromUrl } from "../utils.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
interface TorrentInfo {
	complete?: boolean;
	save_path: string;
	state?: string;
	progress?: number;
	label?: string;
}
enum DelugeErrorCode {
	NO_AUTH = 1,
	BAD_METHOD = 2,
	CALL_ERR = 3,
	RPC_FAIL = 4,
	BAD_JSON = 5,
}
type InjectData = [
	filename: string,
	filedump: string,
	options: {
		add_paused: boolean;
		seed_mode: boolean;
		download_location: string;
	}
];
type WebHostList = [string, string, number, string][];
type ErrorType = { message?: string; code?: DelugeErrorCode };
type TorrentStatus = { torrents?: Record<string, TorrentInfo> };

type DelugeJSON<ResultType> = {
	result?: ResultType;
	error?: ErrorType;
};

export default class Deluge implements TorrentClient {
	private delugeCookie: string | null = null;
	private delugeLabel = TORRENT_TAG;
	private delugeLabelSuffix = TORRENT_CATEGORY_SUFFIX;
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
			const authResponse = await this.call<boolean>(
				"auth.login",
				[password],
				0
			);
			if (!authResponse.result) {
				throw new CrossSeedError(
					`Reached Deluge, but failed to authenticate: ${href}`
				);
			}
		} catch (networkError) {
			throw new CrossSeedError(networkError);
		}
		const connectedResponse = await this.call<boolean>(
			"web.connected",
			[],
			0
		);

		if (!connectedResponse.result) {
			logger.warn(
				"Deluge WebUI disconnected from daemon...attempting to reconnect."
			);
			const webuiHostList = await this.call<WebHostList>(
				"web.get_hosts",
				[],
				0
			);
			const connectResponse = await this.call<undefined>(
				"web.connect",
				[webuiHostList.result![0][0]],
				0
			);
			if (!connectResponse.error) {
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
	private async call<ResultType>(
		method: string,
		params: unknown[],
		retries = 1
	): Promise<DelugeJSON<ResultType>> {
		const { delugeRpcUrl } = getRuntimeConfig();
		const { href } =
			extractCredentialsFromUrl(delugeRpcUrl).unwrapOrThrow();
		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeJSON<ResultType>;
		const id = Math.floor(Math.random() * 0x7fffffff);
		try {
			response = await fetch(href, {
				body: JSON.stringify({
					method,
					params,
					id,
				}),
				method: "POST",
				headers,
			});
		} catch (networkError) {
			throw new Error(`Failed to connect to Deluge at ${href}`, {
				cause: networkError,
			});
		}
		try {
			json = (await response.json()) as DelugeJSON<ResultType>;
		} catch (jsonParseError) {
			throw new Error(
				`Deluge method ${method} response was non-JSON ${jsonParseError}`
			);
		}
		if (json.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			this.delugeCookie = null;
			await this.authenticate();
			if (this.delugeCookie) {
				return this.call<ResultType>(method, params, 0);
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
		if (headers.has("Set-Cookie")) {
			this.delugeCookie = headers.get("Set-Cookie")!.split(";")[0];
		}
	}

	/**
	 * checks enabled plugins for "Label"
	 * returns true if successful.
	 */
	private async labelEnabled() {
		const enabledPlugins = await this.call<string>(
			"core.get_enabled_plugins",
			[]
		);
		return enabledPlugins.error
			? false
			: enabledPlugins.result!.includes("Label");
	}

	/**
	 * if Label plugin is loaded, adds (if necessary)
	 * and sets the label based on torrent hash.
	 */
	private async setLabel(infoHash: string, label: string): Promise<void> {
		if (this.isLabelEnabled) {
			const setResult = await this.call<void>("label.set_torrent", [
				infoHash,
				label,
			]);
			if (setResult.error?.code === DelugeErrorCode.RPC_FAIL) {
				await this.call<void>("label.add", [label]);
				await this.call<void>("label.set_torrent", [infoHash, label]);
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
			const { duplicateCategories } = getRuntimeConfig();
			let torrentInfo: TorrentInfo;
			if (searchee.infoHash) {
				torrentInfo = await this.getTorrentInfo(searchee);
				if (!torrentInfo.complete) {
					return InjectionResult.TORRENT_NOT_COMPLETE;
				}
			}
			if (!path && (!searchee.infoHash || !torrentInfo!)) {
				logger.debug({
					label: Label.DELUGE,
					message: `Injection failure: ${newTorrent.name} was missing critical data.`,
				});
				return InjectionResult.FAILURE;
			}

			const params = this.formatData(
				`${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`,
				newTorrent.encode().toString("base64"),
				path ? path : torrentInfo!.save_path,
				!!searchee.infoHash
			);
			const addResult = await this.call<string>(
				"core.add_torrent_file",
				params
			);
			if (addResult.result) {
				const { dataCategory } = getRuntimeConfig();
				await this.setLabel(
					newTorrent.infoHash,
					searchee.path
						? dataCategory
						: torrentInfo!.label
						? duplicateCategories
							? torrentInfo!.label.endsWith(
									this.delugeLabelSuffix
							  )
								? torrentInfo!.label
								: `${torrentInfo!.label}${
										this.delugeLabelSuffix
								  }`
							: torrentInfo!.label
						: this.delugeLabel
				);
				return InjectionResult.SUCCESS;
			} else if (addResult.error!.message!.includes("already")) {
				return InjectionResult.ALREADY_EXISTS;
			} else if (addResult.error!.message) {
				logger.debug({
					label: Label.DELUGE,
					message: `Injection failed: ${addResult.error!.message}`,
				});
				return InjectionResult.FAILURE;
			} else {
				logger.debug({
					label: Label.DELUGE,
					message: `Unknown injection failure: ${newTorrent.name} (${newTorrent.infoHash})`,
				});
				return InjectionResult.FAILURE;
			}
		} catch (injectResult) {
			console.error(injectResult);
			if (injectResult.includes("label.set_torrent")) {
				logger.warning({
					label: Label.DELUGE,
					message: `Labeling failure: ${newTorrent.name} (${newTorrent.infoHash})`,
				});
				return InjectionResult.SUCCESS;
			} else {
				logger.error({
					label: Label.DELUGE,
					message: `Injection failed: ${injectResult}`,
				});
				logger.debug(injectResult);
				return InjectionResult.FAILURE;
			}
		}
	}

	/**
	 * formats the json for rpc calls to inject
	 */
	private formatData(
		filename: string,
		filedump: string,
		path: string,
		isTorrent: boolean
	): InjectData {
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
	 * returns directory of a infohash in deluge as a string
	 */
	async getDownloadDir(
		searchee: Searchee
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		let torrent: TorrentInfo, response: DelugeJSON<TorrentStatus>;
		const params = [["save_path", "progress"], { hash: searchee.infoHash }];
		try {
			response = await this.call<TorrentStatus>("web.update_ui", params);
		} catch (e) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (response.result!.torrents) {
			torrent = response.result!.torrents?.[searchee.infoHash!];
		} else {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (torrent === undefined) {
			return resultOfErr("NOT_FOUND");
		} else if (
			response.result!.torrents?.[searchee.infoHash!].progress !== 100
		) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		return resultOf(torrent.save_path);
	}

	/**
	 * returns information needed to complete/validate injection
	 */
	private async getTorrentInfo(searchee: Searchee): Promise<TorrentInfo> {
		if (!searchee.infoHash) {
			throw new Error("Can't search a torrent without a infoHash");
		}

		let torrent: TorrentInfo;
		try {
			const params = [
				["state", "progress", "save_path", "label"],
				{ hash: searchee.infoHash },
			];

			const response = await this.call<TorrentStatus>(
				"web.update_ui",
				params
			);

			if (response.result!.torrents) {
				torrent = response.result!.torrents?.[searchee.infoHash];
			} else {
				throw new Error(
					"Client returned unexpected response (object missing)"
				);
			}
			if (torrent === undefined) {
				throw new Error(
					`Torrent not found in client (${searchee.infoHash})`
				);
			}

			const completedTorrent =
				torrent.state === "Seeding" || torrent.progress === 100;
			const torrentLabel =
				this.isLabelEnabled && torrent.label!.length != 0
					? torrent.label
					: undefined;

			return {
				complete: completedTorrent,
				save_path: torrent.save_path,
				label: torrentLabel,
			};
		} catch (e) {
			logger.error({
				label: Label.DELUGE,
				message: `Failed to fetch torrent data: ${searchee.name} - (${searchee.infoHash})`,
			});
			logger.debug(e);
			throw new Error("web.update_ui: failed to fetch data from client", {
				cause: e,
			});
		}
	}
}
