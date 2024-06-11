import ms from "ms";
import {
	DecisionAnyMatch,
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
import { shouldRecheck, extractCredentialsFromUrl, wait } from "../utils.js";
import { Result, resultOf, resultOfErr } from "../Result.js";

interface TorrentInfo {
	name?: string;
	complete?: boolean;
	save_path: string;
	state?: string;
	progress?: number;
	label?: string;
	total_remaining?: number;
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
	},
];
type WebHostList = [string, string, number, string][];
type ErrorType = { message: string; code?: DelugeErrorCode };
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
	private delugeRequestId: number = 0;

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
			delugeRpcUrl,
		).unwrapOrThrow(
			new CrossSeedError("delugeRpcUrl must be percent-encoded"),
		);
		if (!password) {
			throw new CrossSeedError(
				"You need to define a password in the delugeRpcUrl. (e.g. http://:<PASSWORD>@localhost:8112)",
			);
		}
		try {
			const authResponse = (
				await this.call<boolean>("auth.login", [password], 0)
			).unwrapOrThrow(new Error("failed to connect for authentication"));

			if (!authResponse) {
				throw new CrossSeedError(
					`Reached Deluge, but failed to authenticate: ${href}`,
				);
			}
		} catch (networkError) {
			throw new CrossSeedError(networkError);
		}
		const isConnectedResponse = await this.call<boolean>(
			"web.connected",
			[],
			0,
		);
		if (isConnectedResponse.isOk() && !isConnectedResponse.unwrap()) {
			logger.warn(
				"Deluge WebUI disconnected from daemon...attempting to reconnect.",
			);
			const webuiHostList = (
				await this.call<WebHostList>("web.get_hosts", [], 0)
			).unwrapOrThrow(new Error("failed to get host-list for reconnect"));
			const connectResponse = await this.call<undefined>(
				"web.connect",
				[webuiHostList[0][0]],
				0,
			);
			if (connectResponse.isOk() && connectResponse.unwrap()) {
				logger.info("Deluge WebUI connected to the daemon.");
			} else {
				throw new CrossSeedError(
					"Unable to connect WebUI to Deluge daemon. Connect to the WebUI to resolve this.",
				);
			}
		}
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 * @param method RPC method to send (usually prefaced with module name)
	 * @param params parameters for the method (usually in an array)
	 * @param retries specify a retry count (optional)
	 * @return a promised Result of the specified ResultType or an ErrorType
	 */
	private async call<ResultType>(
		method: string,
		params: unknown[],
		retries = 1,
	): Promise<Result<ResultType, ErrorType>> {
		const { delugeRpcUrl } = getRuntimeConfig();
		const { href } = extractCredentialsFromUrl(delugeRpcUrl).unwrapOrThrow(
			new CrossSeedError("delugeRpcUrl must be percent-encoded"),
		);
		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeJSON<ResultType>;
		const abortController = new AbortController();

		setTimeout(
			() => void abortController.abort(),
			ms("10 seconds"),
		).unref();

		try {
			response = await fetch(href, {
				body: JSON.stringify({
					method,
					params,
					id: this.delugeRequestId++,
				}),
				method: "POST",
				headers,
				signal: abortController.signal,
			});
		} catch (networkError) {
			if (networkError.name === "AbortError") {
				throw new Error(
					`Deluge method ${method} timed out after 10 seconds`,
				);
			}
			throw new Error(`Failed to connect to Deluge at ${href}`, {
				cause: networkError,
			});
		}
		try {
			json = (await response.json()) as DelugeJSON<ResultType>;
		} catch (jsonParseError) {
			throw new Error(
				`Deluge method ${method} response was non-JSON ${jsonParseError}`,
			);
		}
		if (json.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			this.delugeCookie = null;
			await this.authenticate();
			if (this.delugeCookie) {
				return this.call<ResultType>(method, params, 0);
			} else {
				throw new Error(
					"Connection lost with Deluge. Re-authentication failed.",
				);
			}
		}
		this.handleResponseHeaders(response.headers);

		if (json.error) {
			return resultOfErr(json.error);
		}
		return resultOf(json.result!);
	}

	/**
	 * parses the set-cookie header and updates stored value
	 * @param headers the headers from a request
	 */
	private handleResponseHeaders(headers: Headers) {
		if (headers.has("Set-Cookie")) {
			this.delugeCookie = headers.get("Set-Cookie")!.split(";")[0];
		}
	}

	/**
	 * checks enabled plugins for "Label"
	 * @return boolean declaring whether the "Label" plugin is enabled
	 */
	private async labelEnabled() {
		const enabledPlugins = await this.call<string>(
			"core.get_enabled_plugins",
			[],
		);
		if (enabledPlugins.isOk()) {
			return enabledPlugins.unwrap().includes("Label");
		} else {
			return false;
		}
	}
	/**
	 * generates the label for injection based on searchee and torrentInfo
	 * @param searchee Searchee that contains the originating torrent
	 * @param torrentInfo TorrentInfo from the searchee
	 * @return string with the label for the newTorrent
	 */
	private calculateLabel(
		searchee: Searchee,
		torrentInfo: TorrentInfo,
	): string {
		const { linkCategory, duplicateCategories } = getRuntimeConfig();
		if (!searchee.infoHash || !torrentInfo!.label) {
			return this.delugeLabel;
		}
		const ogLabel = torrentInfo!.label;
		if (!duplicateCategories) {
			return ogLabel;
		}
		const shouldSuffixLabel =
			!ogLabel.endsWith(this.delugeLabelSuffix) && // no .cross-seed
			ogLabel !== linkCategory; // not data

		return !searchee.infoHash
			? linkCategory
			: shouldSuffixLabel
				? `${ogLabel}${this.delugeLabelSuffix}`
				: ogLabel;
	}
	/**
	 * if Label plugin is loaded, adds (if necessary)
	 * and sets the label based on torrent hash.
	 * @param newTorrent the searchee of the newTorrent
	 * @param label the destination label for the newTorrent/searchee
	 */
	private async setLabel(newTorrent: Searchee, label: string): Promise<void> {
		let setResult: Result<void, ErrorType>;
		if (!this.isLabelEnabled) return;
		try {
			const getCurrentLabels = await this.call<string[]>(
				"label.get_labels",
				[],
			);
			if (getCurrentLabels.isErr()) {
				this.isLabelEnabled = false;
				throw new Error("Labels have been disabled.");
			}
			if (getCurrentLabels.unwrap().includes(label)) {
				setResult = await this.call<void>("label.set_torrent", [
					newTorrent.infoHash,
					label,
				]);
			} else {
				await this.call<void>("label.add", [label]);
				await wait(300);
				setResult = await this.call<void>("label.set_torrent", [
					newTorrent.infoHash,
					label,
				]);
			}
			if (setResult.isErr()) {
				throw new Error(setResult.unwrapErr().message);
			}
		} catch (e) {
			logger.debug(e);
			logger.warn({
				label: Label.DELUGE,
				message: `Failed to label ${newTorrent.name} (${newTorrent.infoHash}) as ${label}`,
			});
		}
	}

	/**
	 * injects a torrent into deluge client
	 * @param newTorrent injected candidate torrent
	 * @param searchee originating torrent (searchee)
	 * @param decision decision by which the newTorrent was matched
	 * @param path location of the linked files (optional)
	 * @return InjectionResult of the newTorrent's injection
	 */
	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		path?: string,
	): Promise<InjectionResult> {
		try {
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

			const torrentFileName = `${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`;
			const encodedTorrentData = newTorrent.encode().toString("base64");
			const torrentPath = path ? path : torrentInfo!.save_path;
			const params = this.formatData(
				torrentFileName,
				encodedTorrentData,
				torrentPath,
				decision,
			);

			const addResponse = await this.call<string>(
				"core.add_torrent_file",
				params,
			);
			if (addResponse.isErr()) {
				const addResponseError = addResponse.unwrapErr();
				if (addResponseError.message.includes("already")) {
					return InjectionResult.ALREADY_EXISTS;
				} else if (addResponseError) {
					logger.debug({
						label: Label.DELUGE,
						message: `Injection failed: ${addResponseError.message}`,
					});
					return InjectionResult.FAILURE;
				} else {
					logger.debug({
						label: Label.DELUGE,
						message: `Unknown injection failure: ${newTorrent.name} (${newTorrent.infoHash})`,
					});
					return InjectionResult.FAILURE;
				}
			}
			if (addResponse.isOk()) {
				await this.setLabel(
					newTorrent,
					this.calculateLabel(searchee, torrentInfo!),
				);

				if (shouldRecheck(decision)) {
					// when paused, libtorrent doesnt start rechecking
					// leaves torrent ready to download - ~99%
					await wait(1000);
					await this.call<string>("core.force_recheck", [
						[newTorrent.infoHash],
					]);
				}
			}
		} catch (error) {
			logger.error({
				label: Label.DELUGE,
				message: `Injection failed: ${error}`,
			});
			logger.debug(error);
			return InjectionResult.FAILURE;
		}
		return InjectionResult.SUCCESS;
	}

	/**
	 * formats the json for rpc calls to inject
	 * @param filename filename for the injecting torrent file
	 * @param filedump string with encoded torrent file
	 * @param path path to the torrent data
	 * @param decision decision by which the newTorrent was matched
	 */
	private formatData(
		filename: string,
		filedump: string,
		path: string,
		decision: DecisionAnyMatch,
	): InjectData {
		const toRecheck = shouldRecheck(decision);
		return [
			filename,
			filedump,
			{
				add_paused: toRecheck,
				seed_mode: !toRecheck,
				download_location: path,
			},
		];
	}

	/**
	 * returns directory of an infohash in deluge as a string
	 * @param searchee Searchee or Metafile for torrent to lookup in client
	 * @return Result containing either a string with path or reason it was not provided
	 */
	async getDownloadDir(
		searchee: Searchee,
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		let torrent: TorrentInfo, response: Result<TorrentStatus, ErrorType>;
		const params = [["save_path", "progress"], { hash: searchee.infoHash }];
		try {
			response = await this.call<TorrentStatus>("web.update_ui", params);
		} catch (e) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (response.isOk()) {
			const torrentResponse = response.unwrap().torrents;
			if (!torrentResponse) {
				return resultOfErr("UNKNOWN_ERROR");
			}
			torrent = torrentResponse![searchee.infoHash!];
			if (!torrent) {
				return resultOfErr("NOT_FOUND");
			}
			if (torrent.progress !== 100) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
		} else {
			return resultOfErr("UNKNOWN_ERROR");
		}
		return resultOf(torrent.save_path);
	}
	/**
	 * returns information needed to complete/validate injection
	 * @param searchee the Searchee for the torrent you are requesting TorrentInfo from
	 * @return Promise of TorrentInfo type
	 */
	private async getTorrentInfo(searchee: Searchee): Promise<TorrentInfo> {
		if (!searchee.infoHash) {
			throw new Error("Can't search a torrent without a infoHash");
		}

		let torrent: TorrentInfo;
		try {
			const params = [
				[
					"name",
					"state",
					"progress",
					"save_path",
					"label",
					"total_remaining",
				],
				{ hash: searchee.infoHash },
			];

			const response = (
				await this.call<TorrentStatus>("web.update_ui", params)
			).unwrapOrThrow(new Error("failed to fetch the torrent list"));

			if (response.torrents) {
				torrent = response.torrents?.[searchee.infoHash];
			} else {
				throw new Error(
					"Client returned unexpected response (object missing)",
				);
			}
			if (torrent === undefined) {
				throw new Error(
					`Torrent not found in client (${searchee.infoHash})`,
				);
			}

			const completedTorrent =
				(torrent.state === "Paused" &&
					(torrent.progress === 100 || !torrent.total_remaining)) ||
				torrent.state === "Seeding" ||
				torrent.progress === 100 ||
				!torrent.total_remaining;

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
