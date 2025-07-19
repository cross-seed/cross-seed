import { readdir } from "fs/promises";
import ms from "ms";
import { basename } from "path";
import { inspect } from "util";
import {
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_CATEGORY_SUFFIX,
	TORRENT_TAG,
	USER_AGENT,
} from "../constants.js";
import { db } from "../db.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import {
	createSearcheeFromDB,
	parseTitle,
	Searchee,
	SearcheeClient,
	SearcheeWithInfoHash,
	updateSearcheeClientDB,
} from "../searchee.js";
import {
	extractCredentialsFromUrl,
	getLogString,
	humanReadableSize,
	sanitizeInfoHash,
	wait,
} from "../utils.js";
import {
	shouldResumeFromNonRelevantFiles,
	clientSearcheeModified,
	ClientSearcheeResult,
	getMaxRemainingBytes,
	getResumeStopTime,
	organizeTrackers,
	resumeErrSleepTime,
	resumeSleepTime,
	shouldRecheck,
	TorrentClient,
	TorrentMetadataInClient,
} from "./TorrentClient.js";

interface TorrentInfo {
	name?: string;
	complete?: boolean;
	save_path?: string;
	state?: string;
	progress?: number;
	label?: string;
	total_size?: number;
	total_remaining?: number;
	files?: { path: string; size: number }[];
	trackers?: { url: string; tier: number }[];
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
	readonly url: string;
	readonly clientHost: string;
	readonly clientPriority: number;
	readonly clientType = Label.DELUGE;
	readonly readonly: boolean;
	readonly label: string;
	private delugeCookie: string | null = null;
	private delugeLabel = TORRENT_TAG;
	private delugeLabelSuffix = TORRENT_CATEGORY_SUFFIX;
	private isLabelEnabled: boolean;
	private delugeRequestId: number = 0;

	constructor(
		url: string,
		clientHost: string,
		priority: number,
		readonly: boolean,
	) {
		this.url = url;
		this.clientHost = clientHost;
		this.clientPriority = priority;
		this.readonly = readonly;
		this.label = `${this.clientType}@${this.clientHost}`;
	}

	/**
	 * validates the login and host for deluge webui
	 */
	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		await this.authenticate();
		this.isLabelEnabled = await this.labelEnabled();
		logger.info({
			label: this.label,
			message: `Logged in successfully${this.readonly ? " (readonly)" : ""}`,
		});

		if (!torrentDir) return;
		if (!(await readdir(torrentDir)).some((f) => f.endsWith(".state"))) {
			throw new CrossSeedError(
				`[${this.label}] Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir`,
			);
		}
	}

	/**
	 * connects and authenticates to the webui
	 */
	private async authenticate(): Promise<void> {
		const { href, password } = extractCredentialsFromUrl(
			this.url,
		).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] delugeRpcUrl must be percent-encoded`,
			),
		);
		if (!password) {
			throw new CrossSeedError(
				`[${this.label}] You need to define a password in the delugeRpcUrl. (e.g. http://:<PASSWORD>@localhost:8112)`,
			);
		}
		try {
			const authResponse = (
				await this.call<boolean>("auth.login", [password], 0)
			).unwrapOrThrow(
				new Error(
					`[${this.label}] failed to connect for authentication`,
				),
			);

			if (!authResponse) {
				throw new CrossSeedError(
					`[${this.label}] Reached Deluge, but failed to authenticate: ${href}`,
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
			logger.warn({
				label: this.label,
				message:
					"Deluge WebUI disconnected from daemon...attempting to reconnect.",
			});
			const webuiHostList = (
				await this.call<WebHostList>("web.get_hosts", [], 0)
			).unwrapOrThrow(
				new Error(
					`[${this.label}] failed to get host-list for reconnect`,
				),
			);
			const connectResponse = await this.call<undefined>(
				"web.connect",
				[webuiHostList[0][0]],
				0,
			);
			if (connectResponse.isOk() && connectResponse.unwrap()) {
				logger.info({
					label: this.label,
					message: "Deluge WebUI connected to the daemon.",
				});
			} else {
				throw new CrossSeedError(
					`[${this.label}] Unable to connect WebUI to Deluge daemon. Connect to the WebUI to resolve this.`,
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
		const msg = `Calling method ${method} with params ${inspect(params, { depth: null, compact: true })}`;
		const message = msg.length > 1000 ? `${msg.slice(0, 1000)}...` : msg;
		logger.verbose({ label: this.label, message });
		const { href } = extractCredentialsFromUrl(this.url).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] delugeRpcUrl must be percent-encoded`,
			),
		);
		const headers = new Headers({
			"Content-Type": "application/json",
			"User-Agent": USER_AGENT,
		});
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeJSON<ResultType>;

		try {
			response = await fetch(href, {
				body: JSON.stringify({
					method,
					params,
					id: this.delugeRequestId++,
				}),
				method: "POST",
				headers,
				signal: AbortSignal.timeout(ms("10 seconds")),
			});
		} catch (networkError) {
			if (
				networkError.name === "AbortError" ||
				networkError.name === "TimeoutError"
			) {
				throw new Error(
					`[${this.label}] Deluge method ${method} timed out after 10 seconds`,
				);
			}
			throw new Error(
				`[${this.label}] Failed to connect to Deluge at ${href}`,
				{
					cause: networkError,
				},
			);
		}
		try {
			json = (await response.json()) as DelugeJSON<ResultType>;
		} catch (jsonParseError) {
			throw new Error(
				`[${this.label}] Deluge method ${method} response was non-JSON ${jsonParseError}`,
			);
		}
		if (json.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			this.delugeCookie = null;
			await this.authenticate();
			if (this.delugeCookie) {
				return this.call<ResultType>(method, params, 0);
			} else {
				throw new Error(
					`[${this.label}] Connection lost with Deluge. Re-authentication failed.`,
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
	 * checks the status of an infohash in the client and resumes if/when criteria is met
	 * @param meta MetaFile containing torrent being resumed
	 * @param decision decision by which the newTorrent was matched
	 * @param options options object for extra flags
	 * @param options.checkOnce boolean to only check for resuming once
	 * @param options.meta metafile object containing the torrent data
	 */
	async resumeInjection(
		meta: Metafile,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	): Promise<void> {
		const infoHash = meta.infoHash;
		let sleepTime = resumeSleepTime;
		const stopTime = getResumeStopTime();
		let stop = false;
		while (Date.now() < stopTime) {
			if (options.checkOnce) {
				if (stop) return;
				stop = true;
			}
			await wait(sleepTime);
			let torrentInfo: TorrentInfo;
			let torrentLog: string;
			try {
				torrentInfo = await this.getTorrentInfo(infoHash);
				if (torrentInfo.state === "Checking") {
					continue;
				}
				torrentLog = `${torrentInfo.name} [${sanitizeInfoHash(infoHash)}]`;
				if (torrentInfo.state !== "Paused") {
					logger.warn({
						label: this.label,
						message: `Will not resume ${torrentLog}: state is ${torrentInfo.state}`,
					});
					return;
				}
				const maxRemainingBytes = getMaxRemainingBytes(meta, decision, {
					torrentLog,
					label: this.label,
				});
				if (torrentInfo.total_remaining! > maxRemainingBytes) {
					if (
						!shouldResumeFromNonRelevantFiles(
							meta,
							torrentInfo.total_remaining!,
							decision,
							{ torrentLog, label: this.label },
						)
					) {
						logger.warn({
							label: this.label,
							message: `autoResumeMaxDownload will not resume ${torrentLog}: remainingSize ${humanReadableSize(torrentInfo.total_remaining!, { binary: true })} > ${humanReadableSize(maxRemainingBytes, { binary: true })} limit`,
						});
						return;
					}
				}
			} catch (e) {
				sleepTime = resumeErrSleepTime; // Dropping connections or restart
				continue;
			}
			logger.info({
				label: this.label,
				message: `Resuming ${torrentLog}: ${humanReadableSize(torrentInfo.total_remaining!, { binary: true })} remaining`,
			});
			await this.call<string>("core.resume_torrent", [[infoHash]]);
			return;
		}
		logger.warn({
			label: this.label,
			message: `Will not resume torrent ${infoHash}: timeout`,
		});
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
		if (!searchee.infoHash || !torrentInfo.label) {
			return this.delugeLabel;
		}
		const ogLabel = torrentInfo.label;
		if (!duplicateCategories) {
			return ogLabel;
		}
		const shouldSuffixLabel =
			!ogLabel.endsWith(this.delugeLabelSuffix) && // no .cross-seed
			ogLabel !== linkCategory; // not data

		return !searchee.infoHash
			? linkCategory ?? ""
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
			logger.warn({
				label: this.label,
				message: `Failed to label ${getLogString(newTorrent)} as ${label}: ${e.message}`,
			});
			logger.debug(e);
		}
	}

	/**
	 * injects a torrent into deluge client
	 * @param newTorrent injected candidate torrent
	 * @param searchee originating torrent (searchee)
	 * @param decision decision by which the newTorrent was matched
	 * @param options.onlyCompleted boolean to only inject completed torrents
	 * @param options.destinationDir location of the linked files (optional)
	 * @return InjectionResult of the newTorrent's injection
	 */
	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		options: { onlyCompleted: boolean; destinationDir?: string },
	): Promise<InjectionResult> {
		try {
			const existsRes = await this.isTorrentInClient(newTorrent.infoHash);
			if (existsRes.isErr()) return InjectionResult.FAILURE;
			if (existsRes.unwrap()) return InjectionResult.ALREADY_EXISTS;
			let torrentInfo: TorrentInfo;
			if (options.onlyCompleted && searchee.infoHash) {
				torrentInfo = await this.getTorrentInfo(searchee.infoHash);
				if (!torrentInfo.complete)
					return InjectionResult.TORRENT_NOT_COMPLETE;
			}
			if (
				!options.destinationDir &&
				(!searchee.infoHash || !torrentInfo!)
			) {
				logger.debug({
					label: this.label,
					message: `Injection failure: ${getLogString(searchee)} was missing critical data.`,
				});
				return InjectionResult.FAILURE;
			}

			const torrentFileName = `${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`;
			const encodedTorrentData = newTorrent.encode().toString("base64");
			const destinationDir = options.destinationDir
				? options.destinationDir
				: torrentInfo!.save_path!;
			const toRecheck = shouldRecheck(newTorrent, decision);
			const params = this.formatData(
				torrentFileName,
				encodedTorrentData,
				destinationDir,
				toRecheck,
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
						label: this.label,
						message: `Injection failed: ${addResponseError.message}`,
					});
					return InjectionResult.FAILURE;
				} else {
					logger.debug({
						label: this.label,
						message: `Unknown injection failure: ${getLogString(newTorrent)}`,
					});
					return InjectionResult.FAILURE;
				}
			}
			if (addResponse.isOk()) {
				await this.setLabel(
					newTorrent,
					this.calculateLabel(searchee, torrentInfo!),
				);

				if (toRecheck) {
					// when paused, libtorrent doesnt start rechecking
					// leaves torrent ready to download - ~99%
					await wait(1000);
					await this.recheckTorrent(newTorrent.infoHash);
					void this.resumeInjection(newTorrent, decision, {
						checkOnce: false,
					});
				}
			}
		} catch (error) {
			logger.error({
				label: this.label,
				message: `Injection failed: ${error}`,
			});
			logger.debug(error);
			return InjectionResult.FAILURE;
		}
		return InjectionResult.SUCCESS;
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		// Pause first as it may resume after recheck automatically
		await this.call<string>("core.pause_torrent", [[infoHash]]);
		await this.call<string>("core.force_recheck", [[infoHash]]);
	}

	/**
	 * formats the json for rpc calls to inject
	 * @param filename filename for the injecting torrent file
	 * @param filedump string with encoded torrent file
	 * @param destinationDir path to the torrent data
	 * @param toRecheck boolean to recheck the torrent
	 */
	private formatData(
		filename: string,
		filedump: string,
		destinationDir: string,
		toRecheck: boolean,
	): InjectData {
		return [
			filename,
			filedump,
			{
				add_paused: toRecheck,
				seed_mode: !toRecheck,
				download_location: destinationDir,
			},
		];
	}

	/**
	 * returns directory of an infohash in deluge as a string
	 * @param meta SearcheeWithInfoHash or Metafile for torrent to lookup in client
	 * @param options options object for extra flags
	 * @param options.onlyCompleted boolean to only return a completed torrent
	 * @return Result containing either a string with path or reason it was not provided
	 */
	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		let response: Result<TorrentStatus, ErrorType>;
		const params = [["save_path", "progress"], { hash: meta.infoHash }];
		try {
			response = await this.call<TorrentStatus>("web.update_ui", params);
		} catch (e) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (!response.isOk()) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrentResponse = response.unwrap().torrents;
		if (!torrentResponse) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrent = torrentResponse[meta.infoHash];
		if (!torrent) {
			return resultOfErr("NOT_FOUND");
		}
		if (options.onlyCompleted && torrent.progress !== 100) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		return resultOf(torrent.save_path!);
	}

	/**
	 * returns map of hashes and download directories for all torrents
	 * @param options.metas array of SearcheeWithInfoHash or Metafile for torrents to lookup in client
	 * @param options.onlyCompleted boolean to only return completed torrents
	 * @return Promise of a Map with hashes and download directories
	 */
	async getAllDownloadDirs(options: {
		onlyCompleted: boolean;
	}): Promise<Map<string, string>> {
		const dirs = new Map<string, string>();
		let response: Result<TorrentStatus, ErrorType>;
		const params = [["save_path", "progress"], {}];
		try {
			response = await this.call<TorrentStatus>("web.update_ui", params);
		} catch (e) {
			return dirs;
		}
		if (!response.isOk()) {
			return dirs;
		}
		const torrentResponse = response.unwrap().torrents;
		if (!torrentResponse) {
			return dirs;
		}
		for (const [hash, torrent] of Object.entries(torrentResponse)) {
			if (options.onlyCompleted && torrent.progress !== 100) continue;
			dirs.set(hash, torrent.save_path!);
		}
		return dirs;
	}

	/**
	 * checks if a torrent exists in deluge
	 * @param inputHash the infoHash of the torrent to check
	 * @return Result containing either a boolean or reason it was not provided
	 */
	async isTorrentInClient(
		inputHash: string,
	): Promise<Result<boolean, Error>> {
		const infoHash = inputHash.toLowerCase();
		try {
			const torrentsRes = await this.call<TorrentStatus>(
				"web.update_ui",
				[[], {}],
			);
			if (torrentsRes.isErr()) {
				const err = torrentsRes.unwrapErr();
				throw new Error(
					`${err.code ? err.code + ": " : ""}${err.message}`,
				);
			}
			const torrents = torrentsRes.unwrap().torrents;
			if (!torrents) throw new Error("No torrents found");
			for (const hash of Object.keys(torrents)) {
				if (hash.toLowerCase() === infoHash) return resultOf(true);
			}
			return resultOf(false);
		} catch (e) {
			return resultOfErr(e);
		}
	}

	/**
	 * checks if a torrent is complete in deluge
	 * @param infoHash the infoHash of the torrent to check
	 * @return Result containing either a boolean or reason it was not provided
	 */
	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		try {
			const torrentInfo = await this.getTorrentInfo(infoHash, {
				useVerbose: true,
			});
			return torrentInfo.complete ? resultOf(true) : resultOf(false);
		} catch (e) {
			return resultOfErr("NOT_FOUND");
		}
	}

	/**
	 * checks if a torrent is checking in deluge
	 * @param infoHash the infoHash of the torrent to check
	 * @return Result containing either a boolean or reason it was not provided
	 */
	async isTorrentChecking(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		try {
			const torrentInfo = await this.getTorrentInfo(infoHash, {
				useVerbose: true,
			});
			return resultOf(torrentInfo.state === "Checking");
		} catch (e) {
			return resultOfErr("NOT_FOUND");
		}
	}

	/**
	 * @return All torrents in the client
	 */
	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const params = [["hash", "label"], {}];
		const response = await this.call<TorrentStatus>(
			"web.update_ui",
			params,
		);
		if (!response.isOk()) {
			return [];
		}
		const torrents = response.unwrap().torrents;
		if (!torrents) {
			return [];
		}
		return Object.entries(torrents).map(([hash, torrent]) => ({
			infoHash: hash,
			category: torrent.label ?? "",
		}));
	}

	/**
	 * Get all searchees from the client and update the db
	 * @param options.newSearcheesOnly only return searchees that are not in the db
	 * @param options.refresh undefined uses the cache, [] refreshes all searchees, or a list of infoHashes to refresh
	 * @return an object containing all searchees and new searchees (refreshed searchees are considered new)
	 */
	async getClientSearchees(options?: {
		newSearcheesOnly?: boolean;
		refresh?: string[];
	}): Promise<ClientSearcheeResult> {
		const searchees: SearcheeClient[] = [];
		const newSearchees: SearcheeClient[] = [];
		const infoHashes = new Set<string>();
		const torrentsRes = await this.call<TorrentStatus>("web.update_ui", [
			["name", "label", "save_path", "total_size", "files", "trackers"],
			{},
		]);
		if (torrentsRes.isErr()) {
			logger.error({
				label: this.label,
				message: "Failed to get torrents from client",
			});
			logger.debug(torrentsRes.unwrapErr());
			return { searchees, newSearchees };
		}
		const torrents = torrentsRes.unwrap().torrents;
		if (!torrents || !Object.keys(torrents).length) {
			logger.verbose({
				label: this.label,
				message: "No torrents found in client",
			});
			return { searchees, newSearchees };
		}
		for (const [hash, torrent] of Object.entries(torrents)) {
			const infoHash = hash.toLowerCase();
			infoHashes.add(infoHash);
			const dbTorrent = await db("client_searchee")
				.where("info_hash", infoHash)
				.where("client_host", this.clientHost)
				.first();
			if (
				!torrent.name ||
				!torrent.save_path ||
				!torrent.files ||
				torrent.trackers === undefined ||
				!torrent.total_size
			) {
				logger.warn({
					label: this.label,
					message: `Skipping torrent ${infoHash} as it's missing data: ${inspect({ ...torrent, trackers: organizeTrackers(torrent.trackers ?? []) })}`,
				});
				continue;
			}
			const name = torrent.name;
			const savePath = torrent.save_path;
			const category = torrent.label ?? "";
			const modified = clientSearcheeModified(
				this.label,
				dbTorrent,
				name,
				savePath,
				{
					category,
				},
			);
			const refresh =
				options?.refresh === undefined
					? false
					: options.refresh.length === 0
						? true
						: options.refresh.includes(infoHash);
			if (!modified && !refresh) {
				if (!options?.newSearcheesOnly) {
					searchees.push(createSearcheeFromDB(dbTorrent));
				}
				continue;
			}
			const files = torrent.files.map((file) => ({
				name: basename(file.path),
				path: file.path,
				length: file.size,
			}));
			if (!files.length) {
				logger.verbose({
					label: this.label,
					message: `No files found for ${torrent.name} [${sanitizeInfoHash(infoHash)}]: skipping`,
				});
				continue;
			}
			const trackers = organizeTrackers(torrent.trackers);
			const title = parseTitle(name, files) ?? name;
			const length = torrent.total_size;
			const searchee: SearcheeClient = {
				infoHash,
				name,
				title,
				files,
				length,
				clientHost: this.clientHost,
				savePath,
				category,
				trackers,
			};
			newSearchees.push(searchee);
			searchees.push(searchee);
		}
		await updateSearcheeClientDB(this.clientHost, newSearchees, infoHashes);
		return { searchees, newSearchees };
	}

	/**
	 * returns information needed to complete/validate injection
	 * @return Promise of TorrentInfo type
	 * @param infoHash infohash to query for in the client
	 * @param options options object for extra flags
	 * @param options.useVerbose use verbose instead of error logging
	 * @return Promise of TorrentInfo type
	 */
	private async getTorrentInfo(
		infoHash: string,
		options?: { useVerbose: boolean },
	): Promise<TorrentInfo> {
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
				{ hash: infoHash },
			];

			const response = (
				await this.call<TorrentStatus>("web.update_ui", params)
			).unwrapOrThrow(new Error("failed to fetch the torrent list"));

			if (response.torrents) {
				torrent = response.torrents?.[infoHash];
			} else {
				throw new Error(
					"Client returned unexpected response (object missing)",
				);
			}
			if (torrent === undefined) {
				throw new Error(`Torrent not found in client (${infoHash})`);
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
				name: torrent.name,
				complete: completedTorrent,
				state: torrent.state,
				save_path: torrent.save_path,
				label: torrentLabel,
				total_remaining: torrent.total_remaining,
			};
		} catch (e) {
			const log = options?.useVerbose ? logger.verbose : logger.error;
			log({
				label: this.label,
				message: `Failed to fetch torrent data for ${infoHash}: ${e.message}`,
			});
			logger.debug(e);
			throw new Error(
				`[${this.label}] web.update_ui: failed to fetch data from client`,
				{
					cause: e,
				},
			);
		}
	}
}
