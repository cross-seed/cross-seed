import { readdir } from "fs/promises";
import ms from "ms";
import { basename } from "path";
import { inspect } from "util";
import {
	DecisionAnyMatch,
	InjectionResult,
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

const XTransmissionSessionId = "X-Transmission-Session-Id";
type Method =
	| "session-get"
	| "torrent-add"
	| "torrent-get"
	| "torrent-stop"
	| "torrent-verify"
	| "torrent-start";

interface Response<T> {
	result: "success" | string;
	arguments: T;
}

interface TorrentGetResponseArgs {
	torrents: {
		hashString: string;
		name: string;
		status: number;
		totalSize: number;
		labels: string[];
		downloadDir: string;
		files: { name: string; length: number; bytesCompleted: number }[];
		trackers: { announce: string; tier: number }[];
		leftUntilDone: number;
		percentDone: number;
	}[];
}

interface TorrentMetadata {
	hashString: string;
	id: number;
	name: string;
}

type TorrentDuplicateResponse = { "torrent-duplicate": TorrentMetadata };
type TorrentAddedResponse = { "torrent-added": TorrentMetadata };
type TorrentAddResponse = TorrentAddedResponse | TorrentDuplicateResponse;

function doesAlreadyExist(
	args: TorrentAddResponse,
): args is TorrentDuplicateResponse {
	return "torrent-duplicate" in args;
}

export default class Transmission implements TorrentClient {
	xTransmissionSessionId: string;
	readonly url: string;
	readonly clientHost: string;
	readonly clientPriority: number;
	readonly clientType = Label.TRANSMISSION;
	readonly readonly: boolean;
	readonly label: string;

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

	private async request<T>(
		method: Method,
		args: unknown = {},
		retries = 1,
		timeout = 0,
	): Promise<T> {
		const msg = `Calling method ${method} with params ${inspect(args, { depth: null, compact: true })}`;
		const message = msg.length > 1000 ? `${msg.slice(0, 1000)}...` : msg;
		logger.verbose({ label: this.label, message });
		const { username, password, href } = extractCredentialsFromUrl(
			this.url,
		).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] Transmission rpc url must be percent-encoded`,
			),
		);

		const headers = new Headers({ "User-Agent": USER_AGENT });
		headers.set("Content-Type", "application/json");
		if (this.xTransmissionSessionId) {
			headers.set(XTransmissionSessionId, this.xTransmissionSessionId);
		}
		if (username && password) {
			const credentials = Buffer.from(`${username}:${password}`).toString(
				"base64",
			);
			headers.set("Authorization", `Basic ${credentials}`);
		}

		const response = await fetch(href, {
			method: "POST",
			body: JSON.stringify({ method, arguments: args }),
			headers,
			signal: AbortSignal.timeout(timeout || ms("5 minutes")),
		});
		if (response.status === 409) {
			this.xTransmissionSessionId = response.headers.get(
				XTransmissionSessionId,
			)!;
			return this.request(method, args, retries - 1);
		}
		try {
			const responseBody = (await response.clone().json()) as Response<T>;
			if (
				responseBody.result === "success" ||
				responseBody.result === "duplicate torrent" // slight hack but best solution for now
			) {
				return responseBody.arguments;
			} else {
				throw new Error(
					`Transmission responded with error: "${responseBody.result}"`,
				);
			}
		} catch (e) {
			if (e instanceof SyntaxError) {
				logger.error({
					label: this.label,
					message: `Transmission returned non-JSON response`,
				});
				logger.debug({
					label: this.label,
					message: response.clone().text(),
				});
			} else {
				logger.error({
					label: this.label,
					message: `Transmission responded with an error: ${e.message}`,
				});
				logger.debug(e);
			}
			throw e;
		}
	}

	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		try {
			await this.request("session-get", {}, 1, ms("10 seconds"));
		} catch (e) {
			throw new CrossSeedError(
				`[${this.label}] Failed to reach Transmission at ${this.clientHost}: ${e.message}`,
			);
		}
		logger.info({
			label: this.label,
			message: `Logged in successfully${this.readonly ? " (readonly)" : ""}`,
		});

		if (!torrentDir) return;
		if (!(await readdir(torrentDir)).some((f) => f.endsWith(".torrent"))) {
			throw new CrossSeedError(
				`[${this.label}] Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir`,
			);
		}
	}

	async checkOriginalTorrent(
		data: SearcheeWithInfoHash | Metafile,
		onlyCompleted: boolean,
	): Promise<
		Result<
			{ downloadDir: string },
			InjectionResult.FAILURE | InjectionResult.TORRENT_NOT_COMPLETE
		>
	> {
		let queryResponse: TorrentGetResponseArgs;
		try {
			queryResponse = await this.request<TorrentGetResponseArgs>(
				"torrent-get",
				{
					fields: ["downloadDir", "percentDone"],
					ids: [data.infoHash],
				},
			);
		} catch (e) {
			return resultOfErr(InjectionResult.FAILURE);
		}
		if (queryResponse.torrents.length === 0) {
			return resultOfErr(InjectionResult.FAILURE);
		}

		const [{ downloadDir, percentDone }] = queryResponse.torrents;

		if (onlyCompleted && percentDone < 1) {
			return resultOfErr(InjectionResult.TORRENT_NOT_COMPLETE);
		}

		return resultOf({ downloadDir });
	}

	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		const result = await this.checkOriginalTorrent(
			meta,
			options.onlyCompleted,
		);
		return result
			.mapOk((r) => r.downloadDir)
			.mapErr((err) => (err === "FAILURE" ? "UNKNOWN_ERROR" : err));
	}

	async getAllDownloadDirs(options: {
		onlyCompleted: boolean;
	}): Promise<Map<string, string>> {
		let torrents = (
			await this.request<TorrentGetResponseArgs>("torrent-get", {
				fields: ["hashString", "downloadDir", "percentDone"],
			})
		).torrents;
		if (options.onlyCompleted) {
			torrents = torrents.filter((torrent) => torrent.percentDone === 1);
		}
		return torrents.reduce((acc, { hashString, downloadDir }) => {
			acc.set(hashString, downloadDir);
			return acc;
		}, new Map());
	}

	async isTorrentInClient(
		inputHash: string,
	): Promise<Result<boolean, Error>> {
		const infoHash = inputHash.toLowerCase();
		try {
			const torrents = (
				await this.request<TorrentGetResponseArgs>("torrent-get", {
					fields: ["hashString"],
				})
			).torrents;
			if (!torrents.length) throw new Error("No torrents found");
			for (const torrent of torrents) {
				if (torrent.hashString.toLowerCase() === infoHash) {
					return resultOf(true);
				}
			}
			return resultOf(false);
		} catch (e) {
			return resultOfErr(e);
		}
	}

	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const queryResponse = await this.request<TorrentGetResponseArgs>(
			"torrent-get",
			{
				fields: ["percentDone"],
				ids: [infoHash],
			},
		);
		if (queryResponse.torrents.length === 0) {
			return resultOfErr("NOT_FOUND");
		}
		const [{ percentDone }] = queryResponse.torrents;
		return resultOf(percentDone === 1);
	}

	async isTorrentChecking(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const queryResponse = await this.request<TorrentGetResponseArgs>(
			"torrent-get",
			{
				fields: ["status"],
				ids: [infoHash],
			},
		);
		if (queryResponse.torrents.length === 0) {
			return resultOfErr("NOT_FOUND");
		}
		const [{ status }] = queryResponse.torrents;
		return resultOf([1, 2].includes(status));
	}

	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const res = await this.request<TorrentGetResponseArgs>("torrent-get", {
			fields: ["hashString", "labels"],
		});
		return res.torrents.map((torrent) => ({
			infoHash: torrent.hashString,
			tags: torrent.labels,
		}));
	}

	async getClientSearchees(options?: {
		newSearcheesOnly?: boolean;
		refresh?: string[];
	}): Promise<ClientSearcheeResult> {
		const searchees: SearcheeClient[] = [];
		const newSearchees: SearcheeClient[] = [];
		const infoHashes = new Set<string>();
		let torrents: TorrentGetResponseArgs["torrents"];
		try {
			torrents = (
				await this.request<TorrentGetResponseArgs>("torrent-get", {
					fields: [
						"hashString",
						"name",
						"files",
						"totalSize",
						"downloadDir",
						"labels",
						"trackers",
					],
				})
			).torrents;
		} catch (e) {
			logger.error({
				label: this.label,
				message: `Failed to get torrents from client: ${e.message}`,
			});
			logger.debug(e);
			return { searchees, newSearchees };
		}
		if (!torrents.length) {
			logger.error({
				label: this.label,
				message: "No torrents found in client",
			});
			return { searchees, newSearchees };
		}
		for (const torrent of torrents) {
			const infoHash = torrent.hashString.toLowerCase();
			infoHashes.add(infoHash);
			const dbTorrent = await db("client_searchee")
				.where("info_hash", infoHash)
				.where("client_host", this.clientHost)
				.first();
			const { name } = torrent;
			const savePath = torrent.downloadDir;
			const tags = torrent.labels;
			const modified = clientSearcheeModified(
				this.label,
				dbTorrent,
				name,
				savePath,
				{
					tags,
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
				name: basename(file.name),
				path: file.name,
				length: file.length,
			}));
			if (!files.length) {
				logger.verbose({
					label: this.label,
					message: `No files found for ${torrent.name} [${sanitizeInfoHash(infoHash)}]: skipping`,
				});
				continue;
			}
			const trackers = organizeTrackers(
				torrent.trackers.map((tracker) => ({
					url: tracker.announce,
					tier: tracker.tier,
				})),
			);
			const title = parseTitle(name, files) ?? name;
			const length = torrent.totalSize;
			const searchee: SearcheeClient = {
				infoHash,
				name,
				title,
				files,
				length,
				clientHost: this.clientHost,
				savePath,
				tags,
				trackers,
			};
			newSearchees.push(searchee);
			searchees.push(searchee);
		}
		await updateSearcheeClientDB(this.clientHost, newSearchees, infoHashes);
		return { searchees, newSearchees };
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		// Pause first as it may resume after recheck automatically
		await this.request<void>("torrent-stop", {
			ids: [infoHash],
		});
		await this.request<void>("torrent-verify", {
			ids: [infoHash],
		});
	}

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
			const queryResponse = await this.request<TorrentGetResponseArgs>(
				"torrent-get",
				{
					fields: ["leftUntilDone", "name", "status"],
					ids: [infoHash],
				},
			);
			if (queryResponse.torrents.length === 0) {
				sleepTime = resumeErrSleepTime; // Dropping connections or restart
				continue;
			}
			const [{ leftUntilDone, name, status }] = queryResponse.torrents;
			if ([1, 2].includes(status)) {
				continue;
			}
			const torrentLog = `${name} [${sanitizeInfoHash(infoHash)}]`;
			if (status !== 0) {
				logger.warn({
					label: this.label,
					message: `Will not resume ${torrentLog}: status is ${status}`,
				});
				return;
			}
			const maxRemainingBytes = getMaxRemainingBytes(meta, decision, {
				torrentLog,
				label: this.label,
			});
			if (leftUntilDone > maxRemainingBytes) {
				if (
					!shouldResumeFromNonRelevantFiles(
						meta,
						leftUntilDone,
						decision,
						{
							torrentLog,
							label: this.label,
						},
					)
				) {
					logger.warn({
						label: this.label,
						message: `autoResumeMaxDownload will not resume ${torrentLog}: remainingSize ${humanReadableSize(leftUntilDone, { binary: true })} > ${humanReadableSize(maxRemainingBytes, { binary: true })} limit`,
					});
					return;
				}
			}
			logger.info({
				label: this.label,
				message: `Resuming ${torrentLog}: ${humanReadableSize(leftUntilDone, { binary: true })} remaining`,
			});
			await this.request<void>("torrent-start", {
				ids: [infoHash],
			});
			return;
		}
		logger.warn({
			label: this.label,
			message: `Will not resume torrent ${infoHash}: timeout`,
		});
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		options: { onlyCompleted: boolean; destinationDir?: string },
	): Promise<InjectionResult> {
		const existsRes = await this.isTorrentInClient(newTorrent.infoHash);
		if (existsRes.isErr()) return InjectionResult.FAILURE;
		if (existsRes.unwrap()) return InjectionResult.ALREADY_EXISTS;
		let destinationDir: string;
		if (options.destinationDir) {
			destinationDir = options.destinationDir;
		} else {
			const result = await this.getDownloadDir(
				searchee as SearcheeWithInfoHash,
				{ onlyCompleted: options.onlyCompleted },
			);
			if (result.isOk()) {
				destinationDir = result.unwrap();
			} else {
				if (result.unwrapErr() === "TORRENT_NOT_COMPLETE") {
					return InjectionResult.TORRENT_NOT_COMPLETE;
				}
				return InjectionResult.FAILURE;
			}
		}

		let addResponse: TorrentAddResponse;

		try {
			const toRecheck = shouldRecheck(newTorrent, decision);
			addResponse = await this.request<TorrentAddResponse>(
				"torrent-add",
				{
					"download-dir": destinationDir,
					metainfo: newTorrent.encode().toString("base64"),
					paused: toRecheck,
					labels: [TORRENT_TAG],
				},
			);
			if (toRecheck) {
				void this.resumeInjection(newTorrent, decision, {
					checkOnce: false,
				});
			}
		} catch (e) {
			return InjectionResult.FAILURE;
		}

		if (doesAlreadyExist(addResponse)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		return InjectionResult.SUCCESS;
	}
}
