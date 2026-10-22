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
type UpdateUiFilter = { hash?: string } & Record<string, unknown>;
type UpdateUiParams = [fields: TorrentInfoField[], filter: UpdateUiFilter];

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
	readonly delugeLabel = TORRENT_TAG;
	readonly delugeLabelSuffix = TORRENT_CATEGORY_SUFFIX;
	private isLabelEnabled: boolean = false;
	private delugeRequestId: number = 0;
	private activeSessions: number = 0;

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
	 * deletes the active webui session when no actions are in flight
	 */
	private async endSession(): Promise<void> {
		if (!this.delugeCookie || this.activeSessions > 0) return;
		try {
			await this.call<boolean>("auth.delete_session", [], 0);
		} catch (e) {
			logger.debug(e);
		} finally {
			this.delugeCookie = null;
		}
	}

	/**
	 * validates the login and host for deluge webui
	 */
	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		this.activeSessions++;
		try {
			await this.authenticate();
			logger.info({
				label: this.label,
				message: `Logged in successfully${this.readonly ? " (readonly)" : ""}`,
			});
		} finally {
			this.activeSessions--;
			await this.endSession();
		}
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
		this.delugeCookie = null;
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
			await wait(300);
			const reconnectedResponse = await this.call<boolean>(
				"web.connected",
				[],
				0,
			);
			if (
				(connectResponse.isOk() && connectResponse.unwrap()) ||
				(reconnectedResponse.isOk() && reconnectedResponse.unwrap())
			) {
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
		this.isLabelEnabled = await this.labelEnabled();
	}

	/**
	 * connects and authenticates to the webui when potential RPC desync is detected
	 * @returns void
	 */
	private async reconnectBadStateWebUI(): Promise<void> {
		const isConnectedResponse = await this.call<boolean>(
			"web.connected",
			[],
		);
		const webuiHostList = (
			await this.call<WebHostList>("web.get_hosts", [])
		).unwrapOrThrow(
			new Error(
				`[${this.label}] failed to get host-list for reconnect.\n\tManual reconnect from the WebUI Connection Manager to potentially resolve this.`,
			),
		);
		if (!webuiHostList.length) {
			throw new CrossSeedError(
				`[${this.label}] No Deluge daemon hosts found in WebUI Connection Manager.`,
			);
		}
		let targetHostId = webuiHostList[0][0];
		for (const [hostId] of webuiHostList) {
			const hostStatus = await this.call<string[]>(
				"web.get_host_status",
				[hostId],
			);
			if (hostStatus.isOk()) {
				const status = hostStatus.unwrap()?.[1];
				if (status === "Connected") {
					targetHostId = hostId;
					break;
				}
				if (status === "Online") {
					targetHostId = hostId;
				}
			}
		}
		if (isConnectedResponse.isOk() && !isConnectedResponse.unwrap()) {
			logger.warn({
				label: this.label,
				message:
					"Deluge WebUI is disconnected from RPC daemon.\n\tAttempting to reconnect to resolve this.",
			});
		} else {
			logger.warn({
				label: this.label,
				message:
					"Deluge WebUI is connected to RPC daemon, but a desync may be occurring.\n\tAttempting to reconnect to resolve this.",
			});
			const disconnectResponse = await this.call<undefined>(
				"web.disconnect",
				[],
			);
			await wait(300);
			const postDisconnectConnected = await this.call<boolean>(
				"web.connected",
				[],
			);
			if (
				disconnectResponse.isOk() &&
				(!postDisconnectConnected.isOk() ||
					!postDisconnectConnected.unwrap())
			) {
				logger.info({
					label: this.label,
					message:
						"Deluge WebUI successfully disconnected from the RPC daemon.",
				});
			} else {
				throw new CrossSeedError(
					`[${this.label}] Unable to disconnect WebUI from Deluge RPC daemon.\n\tManual disconnect and reconnect the WebUI from the WebUI Connection Manager to potentially resolve this.`,
				);
			}
		}
		const connectResponse = await this.call<undefined>("web.connect", [
			targetHostId,
		]);
		await wait(300);
		const isReConnectedResponse = await this.call<boolean>(
			"web.connected",
			[],
		);
		if (
			(connectResponse.isOk() && connectResponse.unwrap()) ||
			(isReConnectedResponse.isOk() && isReConnectedResponse.unwrap())
		) {
			logger.info({
				label: this.label,
				message:
					"Deluge WebUI connected to primary RPC daemon in the WebUI host list.\n\tWill retry failed injections during next 'inject' job (hourly), or run from 'Jobs' manually.",
			});
		} else {
			throw new CrossSeedError(
				`[${this.label}] Unable to connect WebUI to Deluge daemon.\n\tManual reconnect the WebUI from Connection Manager to potentially resolve this.`,
			);
		}
		this.isLabelEnabled = await this.labelEnabled();
	}

	// web.update_ui method (typed params + forced return)
	private async call(
		method: "web.update_ui",
		params: UpdateUiParams,
		retries?: number,
	): Promise<Result<TorrentStatus, ErrorType>>;

	// standard RPC method fallback
	private async call<ResultType>(
		method: string,
		params: unknown[],
		retries?: number,
	): Promise<Result<ResultType, ErrorType>>;

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
		if (
			!this.delugeCookie &&
			method !== "auth.login" &&
			method !== "auth.delete_session"
		) {
			await this.authenticate();
		}
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
			const errName =
				networkError instanceof Error ? networkError.name : "";
			if (errName === "AbortError" || errName === "TimeoutError") {
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
		this.activeSessions++;
		try {
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
					const maxRemainingBytes = getMaxRemainingBytes(
						meta,
						decision,
						{
							torrentLog,
							label: this.label,
						},
					);
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
		} finally {
			this.activeSessions--;
			await this.endSession();
		}
	}

	/**
	 * generates the label for injection based on searchee and torrentInfo
	 * @param searchee Searchee that contains the originating torrent
	 * @param torrentInfo TorrentInfo from the searchee
	 * @param destinationDir destination directory if linking or data-based
	 * @return string with the label for the newTorrent
	 */
	private calculateLabel(
		searchee: Searchee,
		torrentInfo: TorrentInfo | undefined,
		destinationDir?: string,
	): string {
		const { linkCategory, duplicateCategories } = getRuntimeConfig();
		const ogLabel = torrentInfo?.label || searchee.category;
		if (!searchee.infoHash || !ogLabel) {
			return destinationDir
				? linkCategory || this.delugeLabel
				: this.delugeLabel;
		}
		if (!duplicateCategories) {
			return destinationDir ? linkCategory || ogLabel : ogLabel;
		}
		const shouldSuffixLabel =
			!ogLabel.endsWith(this.delugeLabelSuffix) && // no .cross-seed
			ogLabel !== linkCategory; // not data

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
		if (!this.isLabelEnabled || !label.length) return;
		try {
			let getCurrentLabels = await this.call<string[]>(
				"label.get_labels",
				[],
			);
			if (getCurrentLabels.isErr()) {
				await this.reconnectBadStateWebUI();
				await wait(250);
				getCurrentLabels = await this.call<string[]>(
					"label.get_labels",
					[],
				);
			}
			if (getCurrentLabels.isErr()) {
				throw new Error(getCurrentLabels.unwrapErr().message);
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
		this.activeSessions++;
		try {
			const existsRes = await this.isTorrentInClient(newTorrent.infoHash);
			if (existsRes.isErr()) return InjectionResult.FAILURE;
			if (existsRes.unwrap()) return InjectionResult.ALREADY_EXISTS;
			let torrentInfo: TorrentInfo | undefined;
			if (searchee.infoHash) {
				try {
					torrentInfo = await this.getTorrentInfo(searchee.infoHash);
				} catch {
					torrentInfo = undefined;
				}
				if (torrentInfo) {
					if (!torrentInfo.label && searchee.category?.length) {
						torrentInfo.label = searchee.category;
					}
					if (!torrentInfo.save_path && searchee.savePath) {
						torrentInfo.save_path = searchee.savePath;
					}
					if (options.onlyCompleted && !torrentInfo.complete) {
						return InjectionResult.TORRENT_NOT_COMPLETE;
					}
				}
			}
			if (!torrentInfo) {
				if (!options.destinationDir) {
					if (searchee.infoHash) {
						logger.warn({
							label: this.label,
							message: `Searchee torrent may have been deleted, critical data is missing: ${getLogString(searchee)}`,
						});
					}
					await this.reconnectBadStateWebUI();
					await wait(250);
					return InjectionResult.FAILURE;
				}
				if (searchee.infoHash) {
					logger.warn({
						label: this.label,
						message: `Searchee torrent may have been deleted, labeling may not meet expectations: ${getLogString(searchee)}`,
					});
				}
				torrentInfo = {
					name: searchee.name,
					complete: true,
					save_path: searchee.savePath ?? options.destinationDir,
					label:
						this.isLabelEnabled && searchee.category?.length
							? searchee.category
							: undefined,
				};
			}

			const destinationDir =
				options.destinationDir ||
				torrentInfo.save_path ||
				searchee.savePath;
			if (!destinationDir) {
				logger.warn({
					label: this.label,
					message: `Injection failure: ${getLogString(searchee)} was missing save_path.`,
				});
				await this.reconnectBadStateWebUI();
				await wait(250);
				return InjectionResult.FAILURE;
			}

			const torrentFileName = `${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`;
			const encodedTorrentData = newTorrent.encode().toString("base64");
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
				void this.resumeInjection(newTorrent, decision, {
					checkOnce: false,
				});
			}
		} catch (error) {
			logger.error({
				label: this.label,
				message: `Injection failed: ${error}`,
			});
			logger.debug(error);
			return InjectionResult.FAILURE;
		} finally {
			this.activeSessions--;
			await this.endSession();
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
		retries = 1,
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		let response: Result<TorrentStatus, ErrorType>;
		const params: UpdateUiParams = [
			["save_path", "progress", "state", "total_remaining"],
			{ hash: meta.infoHash },
		];
		try {
			response = await this.call("web.update_ui", params);
		} catch {
			return resultOfErr("UNKNOWN_ERROR");
		}
		if (!response.isOk()) {
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrentResponse = response.unwrap().torrents;
		if (!torrentResponse) {
			if (retries > 0) {
				try {
					await this.reconnectBadStateWebUI();
					await wait(250);
					return await this.getDownloadDir(
						meta,
						options,
						retries - 1,
					);
				} catch {
					return resultOfErr("UNKNOWN_ERROR");
				}
			}
			return resultOfErr("UNKNOWN_ERROR");
		}
		const torrent = torrentResponse[meta.infoHash];
		if (!torrent) {
			return resultOfErr("NOT_FOUND");
		}
		if (
			!torrent.save_path ||
			!torrent.state ||
			typeof torrent.progress !== "number" ||
			typeof torrent.total_remaining !== "number"
		) {
			if (retries > 0) {
				try {
					await this.reconnectBadStateWebUI();
					await wait(250);
					return await this.getDownloadDir(
						meta,
						options,
						retries - 1,
					);
				} catch {
					return resultOfErr("UNKNOWN_ERROR");
				}
			}
			return resultOfErr("UNKNOWN_ERROR");
		}
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
		const params: UpdateUiParams = [
			["save_path", "progress", "state", "total_remaining"],
			{},
		];
		try {
			response = await this.call("web.update_ui", params);
		} catch {
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
			if (!torrent.save_path) continue;
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
		retries = 1,
	): Promise<Result<boolean, Error>> {
		const infoHash = inputHash.toLowerCase();
		try {
			const params: UpdateUiParams = [[], { hash: infoHash }];
			const torrentsRes = await this.call("web.update_ui", params);
			if (torrentsRes.isErr()) {
				const err = torrentsRes.unwrapErr();
				throw new Error(
					`${err.code ? err.code + ": " : ""}${err.message}`,
				);
			}
			const torrents = torrentsRes.unwrap().torrents;
			if (!torrents) {
				if (retries > 0) {
					await this.reconnectBadStateWebUI();
					await wait(250);
					return await this.isTorrentInClient(inputHash, retries - 1);
				}
				throw new Error("No torrents found");
			}
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
		const params: UpdateUiParams = [["hash", "label"], {}];
		const response = await this.call("web.update_ui", params);
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
		this.activeSessions++;
		try {
			const params: UpdateUiParams = [
				[
					"name",
					"label",
					"save_path",
					"total_size",
					"files",
					"trackers",
				],
				{},
			];
			let torrentsRes = await this.call("web.update_ui", params);
			if (torrentsRes.isErr()) {
				logger.error({
					label: this.label,
					message: "Failed to get torrents from client",
				});
				logger.debug(torrentsRes.unwrapErr());
				return { searchees, newSearchees };
			}
			let torrents = torrentsRes.unwrap().torrents;
			if (!torrents || !Object.keys(torrents).length) {
				logger.verbose({
					label: this.label,
					message: "No torrents found in client",
				});
				return { searchees, newSearchees };
			}
			const hasMissingData = Object.values(torrents).some(
				(torrent) =>
					!torrent.name ||
					!torrent.save_path ||
					!torrent.files ||
					torrent.trackers === undefined ||
					!torrent.total_size ||
					(this.isLabelEnabled && torrent.label == null),
			);
			if (hasMissingData) {
				try {
					await this.reconnectBadStateWebUI();
					await wait(250);
					const retryRes = await this.call("web.update_ui", params);
					if (retryRes.isOk() && retryRes.unwrap().torrents) {
						torrentsRes = retryRes;
						torrents = retryRes.unwrap().torrents!;
					}
				} catch (e) {
					logger.debug(e);
				}
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
					!torrent.total_size ||
					(this.isLabelEnabled && torrent.label == null)
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
			await updateSearcheeClientDB(
				this.clientHost,
				newSearchees,
				infoHashes,
			);
			return { searchees, newSearchees };
		} finally {
			this.activeSessions--;
			await this.endSession();
		}
	}

	private isComplete(t: TorrentInfo): boolean {
		return (
			t.state === "Seeding" ||
			t.progress === 100 ||
			(t.state === "Paused" && t.total_remaining === 0)
		);
	}

	private isValidTorrentInfo(t: TorrentInfo | undefined): t is TorrentInfo {
		if (!t) return false;
		if (
			!t.name ||
			!t.state ||
			!t.save_path ||
			typeof t.progress !== "number" ||
			typeof t.total_remaining !== "number"
		) {
			return false;
		}
		if (this.isLabelEnabled && t.label == null) {
			return false;
		}
		return true;
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
		retries = 1,
	): Promise<TorrentInfo> {
		let torrent: TorrentInfo | undefined;
		try {
			const params: UpdateUiParams = [
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
				await this.call("web.update_ui", params)
			).unwrapOrThrow(new Error("failed to fetch the torrent list"));

			if (response.torrents) {
				torrent = response.torrents?.[infoHash];
			} else {
				if (retries > 0) {
					await this.reconnectBadStateWebUI();
					await wait(250);
					return await this.getTorrentInfo(
						infoHash,
						options,
						retries - 1,
					);
				}
				throw new Error(
					"Client returned unexpected response (object missing)",
				);
			}
			if (torrent === undefined) {
				throw new Error(`Torrent not found in client (${infoHash})`);
			}
			if (!this.isValidTorrentInfo(torrent)) {
				if (retries > 0) {
					await this.reconnectBadStateWebUI();
					await wait(250);
					return await this.getTorrentInfo(
						infoHash,
						options,
						retries - 1,
					);
				}
				throw new Error(
					`Client returned incomplete torrent data for (${infoHash})`,
				);
			}

			const completedTorrent = this.isComplete(torrent);

			const torrentLabel =
				this.isLabelEnabled && torrent.label?.length
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
