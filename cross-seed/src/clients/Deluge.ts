import { humanReadableSize } from "@cross-seed/shared/utils";
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
import { runInBackground } from "../utils/background.js";
import { db } from "../db.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import {
	ClientSearcheeRow,
	createSearcheeFromDB,
	parseTitle,
	Searchee,
	SearcheeClient,
	SearcheeWithInfoHash,
	updateSearcheeClientDB,
} from "../searchee.js";
import {
	errorMessage,
	extractCredentialsFromUrl,
	getLogString,
	sanitizeInfoHash,
	wait,
} from "../utils.js";
import {
	clientSearcheeModified,
	ClientSearcheeResult,
	getMaxRemainingBytes,
	getResumeStopTime,
	organizeTrackers,
	resumeErrSleepTime,
	resumeSleepTime,
	shouldRecheck,
	shouldResumeFromNonRelevantFiles,
	TorrentClient,
	TorrentMetadataInClient,
} from "./TorrentClient.js";

interface TorrentInfo {
	name?: string;
	hash?: string;
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

type TorrentInfoField = keyof TorrentInfo;
type StatusQuery = [fields: TorrentInfoField[], filter: { hash?: string }];

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
type TorrentStatus = Record<string, TorrentInfo>;

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
	readonly delugeLabel = TORRENT_TAG;
	readonly delugeLabelSuffix = TORRENT_CATEGORY_SUFFIX;
	private isLabelEnabled = false;
	private authPromise: Promise<void> | null = null;
	private connectionPromise: Promise<void> | null = null;
	private connectionGeneration = 0;
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
	async authenticate(): Promise<void> {
		if (this.authPromise) return this.authPromise;
		if (this.delugeCookie) return;
		this.authPromise = this.doAuthenticate()
			.catch((error: unknown) => {
				this.delugeCookie = null;
				throw error;
			})
			.finally(() => {
				this.authPromise = null;
			});
		return this.authPromise;
	}

	private async doAuthenticate(): Promise<void> {
		const { href, password } = extractCredentialsFromUrl(
			this.url,
		).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] The Deluge WebUI URL must be percent-encoded`,
			),
		);
		if (!password) {
			throw new CrossSeedError(
				`[${this.label}] You need to define a password in the Deluge WebUI URL. (e.g. http://:<PASSWORD>@localhost:8112)`,
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

			if (!authResponse || !this.delugeCookie) {
				throw new CrossSeedError(
					`[${this.label}] Reached Deluge, but failed to authenticate: ${href}`,
				);
			}
		} catch (networkError) {
			throw new CrossSeedError(errorMessage(networkError));
		}
		await this.ensureDaemonConnected();
		this.isLabelEnabled = await this.labelEnabled();
	}

	private async ensureDaemonConnected(): Promise<void> {
		if (!this.connectionPromise) {
			this.connectionPromise = this.connectDaemon().finally(() => {
				this.connectionPromise = null;
			});
		}
		return this.connectionPromise;
	}

	private async connectDaemon(): Promise<void> {
		const connected = (
			await this.call<boolean>("web.connected", [], 0)
		).unwrapOrThrow(
			new Error("Failed to read Deluge daemon connection state"),
		);
		if (connected) return;
		const hosts = (
			await this.call<WebHostList>("web.get_hosts", [], 0)
		).unwrapOrThrow(new Error("Failed to read Deluge hosts"));
		if (!hosts.length)
			throw new CrossSeedError(
				`[${this.label}] No Deluge daemon is configured in the WebUI.`,
			);
		const result = await this.call<string[] | null>(
			"web.connect",
			[hosts[0][0]],
			0,
		);
		const afterConnect = await this.call<boolean>("web.connected", [], 0);
		if (result.isErr() || afterConnect.isErr() || !afterConnect.unwrap()) {
			throw new CrossSeedError(
				`[${this.label}] Unable to connect WebUI to Deluge daemon.`,
			);
		}
		this.connectionGeneration++;
	}

	// Core status with diff=false bypasses both SessionProxy and daemon diff state.
	// Single-torrent lookups avoid fetching the entire client's inventory.
	private async getTorrents([fields, filter]: StatusQuery): Promise<
		Result<TorrentStatus, ErrorType>
	> {
		if (filter.hash) {
			const hash = filter.hash.toLowerCase();
			const response = await this.call<TorrentInfo>(
				"core.get_torrent_status",
				[hash, fields, false],
			);
			return response.mapOk((torrent) => {
				if (!torrent || typeof torrent !== "object")
					throw new Error(
						"Missing torrent status in Deluge response",
					);
				return Object.keys(torrent).length ? { [hash]: torrent } : {};
			});
		}
		return this.call<TorrentStatus>("core.get_torrents_status", [
			{},
			fields,
			false,
		]);
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
		if (retries > 0 && method !== "auth.login") {
			await this.authenticate();
			// Deluge 2.0 can leave core requests unanswered while disconnected.
			// Check the connection before dispatch, without reconnecting a
			// healthy daemon or resetting its WebUI cache.
			if (method.startsWith("core.") || method.startsWith("label.")) {
				const connected = (
					await this.call<boolean>("web.connected", [])
				).unwrapOrThrow(
					new Error("Failed to read Deluge daemon connection state"),
				);
				if (!connected) await this.ensureDaemonConnected();
			}
		}
		const requestCookie = this.delugeCookie;
		const connectionGeneration = this.connectionGeneration;
		const truncate = (message: string) =>
			message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
		const { href } = extractCredentialsFromUrl(this.url).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] The Deluge WebUI URL must be percent-encoded`,
			),
		);

		const message =
			method === "auth.login"
				? `Calling authentication method ${method}`
				: `Calling method ${method} with params ${inspect(params, { depth: null, compact: true })}`;
		logger.verbose({ label: this.label, message: truncate(message) });

		const headers = new Headers({
			"Content-Type": "application/json",
			"User-Agent": USER_AGENT,
		});
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		// Bounded retries for transient failures: a failed connection, or a
		// response whose body fails to read/parse after headers already
		// arrived (e.g. the socket closing mid-stream). Separate from the
		// `retries` param above, which governs the NO_AUTH re-auth flow.
		const transientRetries = 3;
		let response: Response, json: DelugeJSON<ResultType>;
		for (let attempt = 0; ; attempt++) {
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
				const errName =
					networkError instanceof Error ? networkError.name : "";
				if (errName === "AbortError" || errName === "TimeoutError") {
					throw new Error(
						`[${this.label}] Deluge method ${method} timed out after 10 seconds`,
					);
				}
				if (attempt >= transientRetries) {
					throw new Error(
						`[${this.label}] Failed to connect to Deluge at ${href}`,
						{ cause: networkError },
					);
				}
				logger.verbose({
					label: this.label,
					message: `Deluge method ${method} failed to connect, ${transientRetries - attempt} retries remaining: ${errorMessage(networkError)}`,
				});
				await wait(
					Math.min(ms("1 second") * 2 ** attempt, ms("10 seconds")),
				);
				continue;
			}
			try {
				json = (await response.json()) as DelugeJSON<ResultType>;
				break;
			} catch (jsonParseError) {
				if (attempt >= transientRetries) {
					throw new Error(
						`[${this.label}] Deluge method ${method} response was non-JSON ${jsonParseError}`,
					);
				}
				logger.verbose({
					label: this.label,
					message: `Deluge method ${method} failed to read response body, ${transientRetries - attempt} retries remaining: ${errorMessage(jsonParseError)}`,
				});
				await wait(
					Math.min(ms("1 second") * 2 ** attempt, ms("10 seconds")),
				);
				continue;
			}
		}
		if (json.error?.code === DelugeErrorCode.NO_AUTH && retries > 0) {
			// A late failure from an old session must not invalidate a newer login.
			if (this.delugeCookie === requestCookie) this.delugeCookie = null;
			await this.authenticate();
			if (this.delugeCookie) {
				return this.call<ResultType>(method, params, 0);
			} else {
				throw new Error(
					`[${this.label}] Connection lost with Deluge. Re-authentication failed.`,
				);
			}
		}
		if (method === "auth.login" || this.delugeCookie === requestCookie) {
			this.handleResponseHeaders(response.headers);
		}
		if (
			json.error &&
			retries > 0 &&
			(method.startsWith("core.") || method.startsWith("label."))
		) {
			const connected = await this.call<boolean>("web.connected", [], 0);
			if (connected.isOk() && !connected.unwrap()) {
				await this.ensureDaemonConnected();
			}
			// Another caller may already have repaired the connection while this
			// request was in flight. Retry against that connection only once.
			if (this.connectionGeneration !== connectionGeneration) {
				return this.call<ResultType>(method, params, 0);
			}
		}

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
		const enabledPlugins = await this.call<string[]>(
			"core.get_enabled_plugins",
			[],
			0,
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
			let torrentInfo: TorrentInfo | undefined;
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
			} catch {
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
		torrentInfo: TorrentInfo | undefined,
		destinationDir?: string,
	): string {
		const { linkCategory, duplicateCategories } = getRuntimeConfig();
		// deluge labels all deal in lowercases, but label.set_torrent requires lowercase on lookup
		// labels from deluge are already lowercase; only linkCategory from cross-seed configs could have uppers
		const delugeLinkCategory = linkCategory?.toLowerCase();
		const ogLabel = torrentInfo?.label || searchee.category;
		if (!searchee.infoHash || !ogLabel) {
			return destinationDir
				? delugeLinkCategory || this.delugeLabel
				: this.delugeLabel;
		}
		if (!duplicateCategories) {
			return destinationDir ? delugeLinkCategory || ogLabel : ogLabel;
		}
		const shouldSuffixLabel =
			!ogLabel.endsWith(this.delugeLabelSuffix) && // no .cross-seed
			ogLabel !== delugeLinkCategory; // not data

		return shouldSuffixLabel
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
			// injection may take longer to actually modify state in deluge than the 250ms
			// this gives 4 attempts to check if torrent exists, totalling 1 second from injection
			for (let i = 0; i < 4; i++) {
				const existsRes = await this.isTorrentInClient(
					newTorrent.infoHash!,
				);
				if (existsRes.isErr())
					throw new Error("Labeling failed. Unknown error.");
				if (existsRes.unwrap()) {
					if (getCurrentLabels.unwrap().includes(label)) {
						setResult = await this.call<void>("label.set_torrent", [
							newTorrent.infoHash,
							label,
						]);
					} else {
						await this.call<void>("label.add", [label]);
						await wait(250);
						setResult = await this.call<void>("label.set_torrent", [
							newTorrent.infoHash,
							label,
						]);
					}
					if (setResult.isErr()) {
						throw new Error(setResult.unwrapErr().message);
					}
				} else {
					await wait(250);
				}
			}
		} catch (e) {
			logger.warn({
				label: this.label,
				message: `Failed to label ${getLogString(newTorrent)} as ${label}: ${errorMessage(e)}`,
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
			let torrentInfo: TorrentInfo | undefined;
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
				const err = addResponse.unwrapErr();
				if (err.message.includes("already")) {
					return InjectionResult.ALREADY_EXISTS;
				}
				logger.debug({
					label: this.label,
					message: `Injection failed: ${err.message}`,
				});
				return InjectionResult.FAILURE;
			}
			await wait(250);
			// addResponse is known to be OK
			await this.setLabel(
				newTorrent,
				this.calculateLabel(
					searchee,
					torrentInfo,
					options.destinationDir,
				),
			);

			if (toRecheck) {
				// when paused, libtorrent doesnt start rechecking
				// leaves torrent ready to download - ~99%
				await wait(1000);
				await this.recheckTorrent(newTorrent.infoHash);
				runInBackground(
					this.resumeInjection(newTorrent, decision, {
						checkOnce: false,
					}),
				);
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
		const params: StatusQuery = [
			["save_path", "progress", "state", "total_remaining"],
			{ hash: meta.infoHash },
		];
		try {
			response = await this.getTorrents(params);
		} catch {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (!response.isOk()) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrentResponse = response.unwrap();
		if (!torrentResponse) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrent = torrentResponse[meta.infoHash.toLowerCase()];
		if (!torrent) {
			return resultOfErr("NOT_FOUND");
		}
		if (
			typeof torrent.save_path !== "string" ||
			typeof torrent.progress !== "number" ||
			typeof torrent.total_remaining !== "number" ||
			typeof torrent.state !== "string"
		)
			return resultOfErr("UNKNOWN_ERROR");
		if (options.onlyCompleted && !this.isComplete(torrent)) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		return resultOf(torrent.save_path);
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
		const params: StatusQuery = [
			["save_path", "progress", "state", "total_remaining"],
			{},
		];
		try {
			response = await this.getTorrents(params);
		} catch {
			return dirs;
		}
		if (!response.isOk()) {
			return dirs;
		}
		const torrentResponse = response.unwrap();
		if (!torrentResponse) {
			return dirs;
		}
		for (const [hash, torrent] of Object.entries(torrentResponse)) {
			if (typeof torrent.save_path !== "string") continue;
			if (options.onlyCompleted && !this.isComplete(torrent)) continue;
			dirs.set(hash, torrent.save_path);
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
			const params: StatusQuery = [["hash"], { hash: infoHash }];
			const torrentsRes = await this.getTorrents(params);
			if (torrentsRes.isErr()) {
				const err = torrentsRes.unwrapErr();
				throw new Error(
					`${err.code ? err.code + ": " : ""}${err.message}`,
				);
			}
			const torrents = torrentsRes.unwrap();
			if (!torrents) throw new Error("No torrents found");
			// torrents infoHash are already toLower() in deluge
			if (infoHash in torrents) return resultOf(true);
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
		} catch {
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
		} catch {
			return resultOfErr("NOT_FOUND");
		}
	}

	/**
	 * @return All torrents in the client
	 */
	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const params: StatusQuery = [["hash", "label"], {}];
		const response = await this.getTorrents(params);
		if (!response.isOk()) {
			return [];
		}
		const torrents = response.unwrap();
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
		libraryScanId?: number;
		newSearcheesOnly?: boolean;
		refresh?: string[];
	}): Promise<ClientSearcheeResult> {
		const searchees: SearcheeClient[] = [];
		const newSearchees: SearcheeClient[] = [];
		const infoHashes = new Set<string>();
		const params: StatusQuery = [
			["name", "label", "save_path", "total_size", "files", "trackers"],
			{},
		];
		const torrentsRes = await this.getTorrents(params);
		if (torrentsRes.isErr()) {
			logger.error({
				label: this.label,
				message: "Failed to get torrents from client",
			});
			logger.debug(torrentsRes.unwrapErr());
			throw new Error("Failed to read Deluge inventory", {
				cause: torrentsRes.unwrapErr(),
			});
		}
		const torrents = torrentsRes.unwrap();
		if (!torrents)
			throw new Error("Missing torrent list in Deluge response");
		if (!Object.keys(torrents).length) {
			logger.verbose({
				label: this.label,
				message: "No torrents found in client",
			});
			await updateSearcheeClientDB(
				this.clientHost,
				[],
				new Set(),
				options?.libraryScanId,
			);
			return { searchees, newSearchees };
		}
		for (const [hash, torrent] of Object.entries(torrents)) {
			const infoHash = hash.toLowerCase();
			infoHashes.add(infoHash);
			if (
				!torrent.name ||
				!torrent.save_path ||
				!Array.isArray(torrent.files) ||
				!Array.isArray(torrent.trackers) ||
				typeof torrent.total_size !== "number"
			) {
				throw new Error(
					`Incomplete Deluge inventory response for ${infoHash}`,
				);
			}
			const dbTorrent = await db<ClientSearcheeRow>("client_searchee")
				.where("info_hash", infoHash)
				.where("client_host", this.clientHost)
				.first();
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
					searchees.push(createSearcheeFromDB(dbTorrent!));
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
		await updateSearcheeClientDB(
			this.clientHost,
			newSearchees,
			infoHashes,
			options?.libraryScanId,
		);
		return { searchees, newSearchees };
	}

	private isComplete(t: TorrentInfo): boolean {
		return (
			t.state === "Seeding" ||
			t.progress === 100 ||
			(t.state === "Paused" && !t.total_remaining)
		);
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
			const params: StatusQuery = [
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

			const response = (await this.getTorrents(params)).unwrapOrThrow(
				new Error("failed to fetch the torrent list"),
			);

			if (response) {
				torrent = response[infoHash.toLowerCase()];
			} else {
				throw new Error(
					"Client returned unexpected response (object missing)",
				);
			}
			if (torrent === undefined) {
				throw new Error(`Torrent not found in client (${infoHash})`);
			}

			if (
				!torrent.name ||
				!torrent.save_path ||
				typeof torrent.state !== "string" ||
				typeof torrent.progress !== "number" ||
				typeof torrent.total_remaining !== "number"
			) {
				throw new Error(`Incomplete Deluge status for ${infoHash}`);
			}
			const completedTorrent = this.isComplete(torrent);

			const torrentLabel =
				this.isLabelEnabled && torrent.label?.length != 0
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
				message: `Failed to fetch torrent data for ${infoHash}: ${errorMessage(e)}`,
			});
			logger.debug(e);
			throw new Error(
				`[${this.label}] core.get_torrent_status: failed to fetch data from client`,
				{
					cause: e,
				},
			);
		}
	}
}
