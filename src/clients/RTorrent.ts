import { readdirSync, type Stats } from "fs";
import { stat } from "fs/promises";
import { basename, dirname, join, resolve, sep } from "path";
import { inspect } from "util";
import xmlrpc, { Client } from "xmlrpc";
import {
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_TAG,
} from "../constants.js";
import { db } from "../db.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import {
	createSearcheeFromDB,
	File,
	parseTitle,
	Searchee,
	SearcheeClient,
	SearcheeWithInfoHash,
	updateSearcheeClientDB,
} from "../searchee.js";
import {
	extractCredentialsFromUrl,
	fromBatches,
	humanReadableSize,
	isTruthy,
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

const COULD_NOT_FIND_INFO_HASH = "Could not find info-hash.";

interface LibTorrentResumeFileEntry {
	completed: number;
	mtime: number;
	priority: number;
}

interface LibTorrentResume {
	bitfield: number;
	files: LibTorrentResumeFileEntry[];
}

interface DownloadLocation {
	/**
	 * directoryBase is the root directory of a multi-file torrent,
	 * or the parent directory of a single-file torrent.
	 */
	directoryBase: string;
	basePath: string;
	downloadDir: string;
}

type Fault = { faultCode: number; faultString: string };

async function createLibTorrentResumeTree(
	meta: Metafile,
	basePath: string,
): Promise<LibTorrentResume> {
	async function getFileResumeData(
		file: File,
	): Promise<LibTorrentResumeFileEntry | null> {
		const filePathWithoutFirstSegment = file.path
			.split(sep)
			.slice(1)
			.join(sep);
		const resolvedFilePath = resolve(basePath, filePathWithoutFirstSegment);
		const fileStat = await stat(resolvedFilePath).catch(
			() => ({ isFile: () => false }) as Stats,
		);
		if (!fileStat.isFile() || fileStat.size !== file.length) {
			return null;
		}

		return {
			completed: Math.ceil(file.length / meta.pieceLength),
			mtime: Math.trunc(fileStat.mtimeMs / 1000),
			priority: 1,
		};
	}

	const fileResumes = await Promise.all(meta.files.map(getFileResumeData));
	return {
		bitfield: Math.ceil(meta.length / meta.pieceLength),
		files: fileResumes.filter(isTruthy),
	};
}

export default class RTorrent implements TorrentClient {
	client: Client;
	readonly clientHost: string;
	readonly clientPriority: number;
	readonly clientType = Label.RTORRENT;
	readonly readonly: boolean;
	readonly label: string;
	readonly batchSize = 500;

	constructor(url: string, priority: number, readonly: boolean) {
		this.clientHost = new URL(url).host;
		this.clientPriority = priority;
		this.readonly = readonly;
		this.label = `${this.clientType}@${this.clientHost}`;
		const { href, username, password } = extractCredentialsFromUrl(
			url,
		).unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] rTorrent url must be percent-encoded`,
			),
		);

		const clientCreator =
			new URL(href).protocol === "https:"
				? xmlrpc.createSecureClient
				: xmlrpc.createClient;

		const shouldUseAuth = Boolean(username && password);

		this.client = clientCreator({
			url: href,
			basic_auth: shouldUseAuth
				? { user: username, pass: password }
				: undefined,
		});
	}

	private async methodCallP<R>(method: string, args): Promise<R> {
		const msg = `Calling method ${method} with params ${inspect(args, { depth: null, compact: true })}`;
		const message = msg.length > 1000 ? `${msg.slice(0, 1000)}...` : msg;
		logger.verbose({ label: this.label, message });
		return new Promise((resolve, reject) => {
			this.client.methodCall(method, args, (err, data) => {
				if (err) return reject(err);
				return resolve(data);
			});
		});
	}

	async checkForInfoHashInClient(infoHash: string): Promise<boolean> {
		const downloadList = await this.methodCallP<string[]>(
			"download_list",
			[],
		);
		return downloadList.includes(infoHash.toUpperCase());
	}

	private async checkOriginalTorrent(
		infoHash: string,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<
			{
				name: string;
				directoryBase: string;
				bytesLeft: number;
				hashing: 0 | 1 | 2 | 3;
				isMultiFile: boolean;
				isActive: boolean;
			},
			"FAILURE" | "TORRENT_NOT_COMPLETE" | "NOT_FOUND"
		>
	> {
		const hash = infoHash.toUpperCase();
		type ReturnType =
			| [
					[string],
					[string],
					[string],
					["0" | "1" | "2" | "3"],
					["0" | "1"],
					["0" | "1"],
					["0" | "1"],
			  ]
			| Fault[];

		let response: ReturnType;
		const args = [
			[
				{
					methodName: "d.name",
					params: [hash],
				},
				{
					methodName: "d.directory",
					params: [hash],
				},
				{
					methodName: "d.left_bytes",
					params: [hash],
				},
				{
					methodName: "d.hashing",
					params: [hash],
				},
				{
					methodName: "d.complete",
					params: [hash],
				},
				{
					methodName: "d.is_multi_file",
					params: [hash],
				},
				{
					methodName: "d.is_active",
					params: [hash],
				},
			],
		];
		try {
			response = await this.methodCallP<ReturnType>(
				"system.multicall",
				args,
			);
		} catch (e) {
			logger.debug({ label: this.label, message: e });
			return resultOfErr("FAILURE");
		}

		function isFault(response: ReturnType): response is Fault[] {
			return "faultString" in response[0];
		}

		try {
			if (isFault(response)) {
				if (response[0].faultString === COULD_NOT_FIND_INFO_HASH) {
					return resultOfErr("NOT_FOUND");
				} else {
					throw new Error(
						"Unknown rTorrent fault while checking original torrent",
					);
				}
			}
			const [
				[name],
				[directoryBase],
				[bytesLeftStr],
				[hashingStr],
				[isCompleteStr],
				[isMultiFileStr],
				[isActiveStr],
			] = response;
			const isComplete = Boolean(Number(isCompleteStr));
			if (options.onlyCompleted && !isComplete) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
			return resultOf({
				name,
				directoryBase,
				bytesLeft: Number(bytesLeftStr),
				hashing: Number(hashingStr) as 0 | 1 | 2 | 3,
				isMultiFile: Boolean(Number(isMultiFileStr)),
				isActive: Boolean(Number(isActiveStr)),
			});
		} catch (e) {
			logger.error({ label: this.label, message: e });
			logger.debug("Failure caused by server response below:");
			logger.debug(inspect(response));
			return resultOfErr("FAILURE");
		}
	}

	private async getDownloadLocation(
		meta: Metafile,
		searchee: Searchee,
		options: { onlyCompleted: boolean; destinationDir?: string },
	): Promise<
		Result<
			DownloadLocation,
			"NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "FAILURE"
		>
	> {
		if (options.destinationDir) {
			// resolve to absolute because we send the path to rTorrent
			const basePath = resolve(options.destinationDir, meta.name);
			const directoryBase = meta.isSingleFileTorrent
				? options.destinationDir
				: basePath;
			return resultOf({
				downloadDir: options.destinationDir,
				basePath,
				directoryBase,
			});
		} else {
			const result = await this.checkOriginalTorrent(searchee.infoHash!, {
				onlyCompleted: options.onlyCompleted,
			});
			return result.mapOk(({ directoryBase }) => ({
				directoryBase,
				downloadDir: meta.isSingleFileTorrent
					? directoryBase
					: dirname(directoryBase),
				basePath: meta.isSingleFileTorrent
					? join(directoryBase, searchee.name)
					: directoryBase,
			}));
		}
	}

	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		try {
			await this.methodCallP<string[]>("download_list", []);
		} catch (e) {
			logger.debug({ label: this.label, message: e });
			throw new CrossSeedError(
				`[${this.label}] Failed to reach rTorrent at ${this.clientHost}: ${e.message}`,
			);
		}
		logger.info({
			label: this.label,
			message: `Logged in successfully${this.readonly ? " (readonly)" : ""}`,
		});

		if (!torrentDir) return;
		if (!readdirSync(torrentDir).some((f) => f.endsWith("_resume"))) {
			throw new CrossSeedError(
				`[${this.label}] Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir`,
			);
		}
	}

	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		if (!(await this.checkForInfoHashInClient(meta.infoHash))) {
			return resultOfErr("NOT_FOUND");
		}
		const result = await this.checkOriginalTorrent(meta.infoHash, options);
		return result
			.mapOk(({ directoryBase, isMultiFile }) => {
				return isMultiFile ? dirname(directoryBase) : directoryBase;
			})
			.mapErr((error) => (error === "FAILURE" ? "UNKNOWN_ERROR" : error));
	}

	async getAllDownloadDirs(options: {
		onlyCompleted: boolean;
	}): Promise<Map<string, string>> {
		const hashes = await this.methodCallP<string[]>("download_list", []);
		type ReturnType = string[][] | Fault[];

		function isFault(response: ReturnType): response is Fault[] {
			return "faultString" in response[0];
		}

		let numMethods = 0;
		const results = await fromBatches(
			hashes,
			async (batch) => {
				const args = [
					batch
						.map((hash) => {
							const arg = [
								{
									methodName: "d.directory",
									params: [hash],
								},
								{
									methodName: "d.is_multi_file",
									params: [hash],
								},
								{
									methodName: "d.complete",
									params: [hash],
								},
							];
							numMethods = arg.length;
							return arg;
						})
						.flat(),
				];
				try {
					const res = await this.methodCallP<ReturnType>(
						"system.multicall",
						args,
					);
					if (isFault(res)) {
						logger.error({
							label: this.label,
							message:
								"Fault while getting download directories for all torrents",
						});
						logger.debug(inspect(res));
						return [];
					}
					return res;
				} catch (e) {
					logger.error({
						label: this.label,
						message: `Failed to get download directories for all torrents: ${e.message}`,
					});
					logger.debug(e);
					return [];
				}
			},
			{ batchSize: this.batchSize },
		);
		if (!results.length || results.length !== hashes.length * numMethods) {
			logger.error({
				label: this.label,
				message: `Unexpected number of results: ${results.length} for ${hashes.length} hashes`,
			});
			return new Map();
		}
		try {
			return hashes.reduce((infoHashSavePathMap, hash, index) => {
				const directory = results[index * numMethods][0];
				const isMultiFile = Boolean(
					Number(results[index * numMethods + 1][0]),
				);
				const isComplete = Boolean(
					Number(results[index * numMethods + 2][0]),
				);
				if (!options.onlyCompleted || isComplete) {
					infoHashSavePathMap.set(
						hash,
						isMultiFile ? dirname(directory) : directory,
					);
				}
				return infoHashSavePathMap;
			}, new Map<string, string>());
		} catch (e) {
			logger.error({
				label: this.label,
				message: `Error parsing response for all torrents: ${e.message}`,
			});
			logger.debug(e);
			return new Map();
		}
	}

	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		try {
			const response = await this.methodCallP<string[]>("d.complete", [
				infoHash,
			]);
			if (response.length === 0) {
				return resultOfErr("NOT_FOUND");
			}
			return resultOf(Boolean(Number(response[0])));
		} catch (e) {
			return resultOfErr("NOT_FOUND");
		}
	}

	async isTorrentChecking(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		try {
			const response = await this.methodCallP<string[]>("d.hashing", [
				infoHash,
			]);
			if (response.length === 0) {
				return resultOfErr("NOT_FOUND");
			}
			return resultOf(Boolean(Number(response[0])));
		} catch (e) {
			return resultOfErr("NOT_FOUND");
		}
	}

	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const hashes = await this.methodCallP<string[]>("download_list", []);
		type ReturnType = string[][] | Fault[];

		function isFault(response: ReturnType): response is Fault[] {
			return "faultString" in response[0];
		}

		const results = await fromBatches(
			hashes,
			async (batch) => {
				const args = [
					batch.map((hash) => {
						return {
							methodName: "d.custom1",
							params: [hash],
						};
					}),
				];
				try {
					const res = await this.methodCallP<ReturnType>(
						"system.multicall",
						args,
					);
					if (isFault(res)) {
						logger.error({
							label: this.label,
							message:
								"Fault while getting torrent info for all torrents",
						});
						logger.debug(inspect(res));
						return [];
					}
					return res;
				} catch (e) {
					logger.error({
						label: this.label,
						message: `Failed to get torrent info for all torrents: ${e.message}`,
					});
					logger.debug(e);
					return [];
				}
			},
			{ batchSize: this.batchSize },
		);
		if (results.length !== hashes.length) {
			logger.error({
				label: this.label,
				message: `Unexpected number of results: ${results.length} for ${hashes.length} hashes`,
			});
			return [];
		}
		try {
			// response: [ [tag1], [tag2], ... ], assuming infoHash order is preserved
			return hashes.map((hash, index) => ({
				infoHash: hash.toLowerCase(),
				tags:
					(results[index] as string[]).length !== 1
						? results[index]
						: results[index][0].length
							? decodeURIComponent(results[index][0])
									.split(",")
									.map((tag) => tag.trim())
							: [],
			})) as TorrentMetadataInClient[];
		} catch (e) {
			logger.error({
				label: this.label,
				message: `Error parsing response for all torrents: ${e.message}`,
			});
			logger.debug(e);
			return [];
		}
	}

	async getClientSearchees(options?: {
		newSearcheesOnly?: boolean;
		refresh?: string[];
	}): Promise<ClientSearcheeResult> {
		const searchees: SearcheeClient[] = [];
		const newSearchees: SearcheeClient[] = [];
		const hashes = await this.methodCallP<string[]>("download_list", []);
		type ReturnType = any[][] | Fault[]; // eslint-disable-line @typescript-eslint/no-explicit-any
		function isFault(response: ReturnType): response is Fault[] {
			return "faultString" in response[0];
		}

		let numMethods = 0;
		const results = await fromBatches(
			hashes,
			async (batch) => {
				const args = [
					batch
						.map((hash) => {
							const arg = [
								{
									methodName: "d.name",
									params: [hash],
								},
								{
									methodName: "d.size_bytes",
									params: [hash],
								},
								{
									methodName: "d.directory",
									params: [hash],
								},
								{
									methodName: "d.is_multi_file",
									params: [hash],
								},
								{
									methodName: "d.custom1",
									params: [hash],
								},
								{
									methodName: "f.multicall",
									params: [
										hash,
										"",
										"f.path=",
										"f.size_bytes=",
									],
								},
								{
									methodName: "t.multicall",
									params: [hash, "", "t.url=", "t.group="],
								},
							];
							numMethods = arg.length;
							return arg;
						})
						.flat(),
				];
				try {
					const res = await this.methodCallP<ReturnType>(
						"system.multicall",
						args,
					);
					if (isFault(res)) {
						logger.error({
							label: this.label,
							message: "Fault while getting client torrents",
						});
						logger.debug(inspect(res));
						return [];
					}
					return res;
				} catch (e) {
					logger.error({
						label: this.label,
						message: `Failed to get client torrents: ${e.message}`,
					});
					logger.debug(e);
					return [];
				}
			},
			{ batchSize: this.batchSize },
		);
		if (!results.length || results.length !== hashes.length * numMethods) {
			logger.error({
				label: this.label,
				message: `Unexpected number of results: ${results.length} for ${hashes.length} hashes`,
			});
			return { searchees, newSearchees };
		}
		const infoHashes = new Set<string>();
		for (let i = 0; i < hashes.length; i++) {
			const infoHash = hashes[i].toLowerCase();
			infoHashes.add(infoHash);
			const dbTorrent = await db("client_searchee")
				.where("info_hash", infoHash)
				.where("client_host", this.clientHost)
				.first();
			const name: string = results[i * numMethods][0];
			const directory: string = results[i * numMethods + 2][0];
			const isMultiFile = Boolean(Number(results[i * numMethods + 3][0]));
			const labels: string = results[i * numMethods + 4][0];
			const savePath = isMultiFile ? dirname(directory) : directory;
			const tags = labels.length
				? decodeURIComponent(labels)
						.split(",")
						.map((tag) => tag.trim())
				: [];
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
			const length = Number(results[i * numMethods + 1][0]);
			const files: File[] = results[i * numMethods + 5][0].map((arr) => ({
				name: basename(arr[0]),
				path: isMultiFile ? join(basename(directory), arr[0]) : arr[0],
				length: Number(arr[1]),
			}));
			if (!files.length) {
				logger.verbose({
					label: this.label,
					message: `No files found for ${name} [${sanitizeInfoHash(infoHash)}]: skipping`,
				});
				continue;
			}
			const trackers = organizeTrackers(
				results[i * numMethods + 6][0].map((arr) => ({
					url: arr[0],
					tier: Number(arr[1]),
				})),
			);
			const title = parseTitle(name, files) ?? name;
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
		await this.methodCallP<void>("d.pause", [infoHash]);
		await this.methodCallP<void>("d.check_hash", [infoHash]);
	}

	async resumeInjection(
		meta: Metafile,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	): Promise<void> {
		const infoHash = meta.infoHash;
		let sleepTime = resumeSleepTime;
		const maxRemainingBytes = getMaxRemainingBytes(decision);
		const stopTime = getResumeStopTime();
		let stop = false;
		while (Date.now() < stopTime) {
			if (options.checkOnce) {
				if (stop) return;
				stop = true;
			}
			await wait(sleepTime);
			const torrentInfoRes = await this.checkOriginalTorrent(infoHash, {
				onlyCompleted: false,
			});
			if (torrentInfoRes.isErr()) {
				sleepTime = resumeErrSleepTime; // Dropping connections or restart
				continue;
			}
			const torrentInfo = torrentInfoRes.unwrap();
			if (torrentInfo.hashing) {
				continue;
			}
			const torrentLog = `${torrentInfo.name} [${sanitizeInfoHash(infoHash)}]`;
			if (torrentInfo.isActive) {
				logger.warn({
					label: this.label,
					message: `Will not resume torrent ${torrentLog}: active`,
				});
				return;
			}
			if (torrentInfo.bytesLeft > maxRemainingBytes) {
				if (
					!shouldResumeFromNonRelevantFiles(
						meta,
						torrentInfo.bytesLeft,
						{ torrentLog, label: this.label },
					)
				) {
					logger.warn({
						label: this.label,
						message: `autoResumeMaxDownload will not resume ${torrentLog}: remainingSize ${humanReadableSize(torrentInfo.bytesLeft, { binary: true })} > ${humanReadableSize(maxRemainingBytes, { binary: true })} limit`,
					});
					return;
				}
			}
			logger.info({
				label: this.label,
				message: `Resuming torrent ${torrentLog}`,
			});
			await this.methodCallP<void>("d.resume", [infoHash]);
		}
		logger.warn({
			label: this.label,
			message: `Will not resume torrent ${infoHash}: timeout`,
		});
	}

	async inject(
		meta: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		options: { onlyCompleted: boolean; destinationDir?: string },
	): Promise<InjectionResult> {
		if (await this.checkForInfoHashInClient(meta.infoHash)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		const result = await this.getDownloadLocation(meta, searchee, options);
		if (result.isErr()) {
			switch (result.unwrapErr()) {
				case "NOT_FOUND":
					return InjectionResult.FAILURE;
				case "TORRENT_NOT_COMPLETE":
					return InjectionResult.TORRENT_NOT_COMPLETE;
				case "FAILURE":
					return InjectionResult.FAILURE;
			}
		}
		const { directoryBase, basePath } = result.unwrap();

		const rawWithLibtorrentResume = {
			...meta.raw,
			libtorrent_resume: await createLibTorrentResumeTree(meta, basePath),
		};

		const toRecheck = shouldRecheck(searchee, decision);
		const loadType = toRecheck ? "load.raw" : "load.raw_start";

		const retries = 5;
		for (let i = 0; i < retries; i++) {
			try {
				await this.methodCallP<void>(
					loadType,
					[
						"",
						new Metafile(rawWithLibtorrentResume).encode(),
						`d.directory_base.set="${directoryBase}"`,
						`d.custom1.set="${TORRENT_TAG}"`,
						`d.custom.set=addtime,${Math.round(Date.now() / 1000)}`,
						toRecheck
							? `d.check_hash=${meta.infoHash.toUpperCase()}`
							: null,
					].filter((e) => e !== null),
				);
				if (toRecheck) {
					this.resumeInjection(meta, decision, {
						checkOnce: false,
					});
				}
				break;
			} catch (e) {
				logger.verbose({
					label: this.label,
					message: `Failed to inject torrent ${meta.name} on attempt ${i + 1}/${retries}: ${e.message}`,
				});
				logger.debug(e);
				await wait(1000 * Math.pow(2, i));
			}
		}

		for (let i = 0; i < 5; i++) {
			if (await this.checkForInfoHashInClient(meta.infoHash)) {
				return InjectionResult.SUCCESS;
			}
			await wait(100 * Math.pow(2, i));
		}
		return InjectionResult.FAILURE;
	}
}
