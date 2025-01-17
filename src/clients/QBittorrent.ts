import { readdirSync } from "fs";
import ms from "ms";
import path from "path";
import { BodyInit } from "undici-types";
import {
	ABS_WIN_PATH_REGEX,
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_CATEGORY_SUFFIX,
	TORRENT_TAG,
} from "../constants.js";
import { memDB } from "../db.js";
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
import {
	extractCredentialsFromUrl,
	extractInt,
	getLogString,
	humanReadableSize,
	Mutex,
	sanitizeInfoHash,
	wait,
	withMutex,
} from "../utils.js";

const X_WWW_FORM_URLENCODED = {
	"Content-Type": "application/x-www-form-urlencoded",
};

interface Preferences {
	resume_data_storage_type?: "Legacy" | "SQLite";
}

interface TorrentInfo {
	added_on: number;
	amount_left: number;
	auto_tmm: boolean;
	availability: number;
	category: string;
	completed: number;
	completion_on: number;
	content_path: string;
	dl_limit: number;
	dlspeed: number;
	download_path?: string;
	downloaded: number;
	downloaded_session: number;
	eta: number;
	f_l_piece_prio: boolean;
	force_start: boolean;
	hash: string;
	inactive_seeding_time_limit?: number;
	infohash_v1?: string;
	infohash_v2?: string;
	last_activity: number;
	magnet_uri: string;
	max_inactive_seeding_time?: number;
	max_ratio: number;
	max_seeding_time: number;
	name: string;
	num_complete: number;
	num_incomplete: number;
	num_leechs: number;
	num_seeds: number;
	priority: number;
	progress: number;
	ratio: number;
	ratio_limit: number;
	save_path: string;
	seeding_time: number;
	seeding_time_limit: number;
	seen_complete: number;
	seq_dl: boolean;
	size: number;
	state: string;
	super_seeding: boolean;
	tags: string;
	time_active: number;
	total_size: number;
	tracker: string;
	trackers_count?: number;
	up_limit: number;
	uploaded: number;
	uploaded_session: number;
	upspeed: number;
}

interface CategoryInfo {
	name: string;
	savePath: string;
}

export default class QBittorrent implements TorrentClient {
	cookie: string;
	url: { username: string; password: string; href: string };
	version: string;
	versionMajor: number;
	readonly type = Label.QBITTORRENT;

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		this.url = extractCredentialsFromUrl(
			qbittorrentUrl!,
			"/api/v2",
		).unwrapOrThrow(
			new CrossSeedError("qBittorrent url must be percent-encoded"),
		);
	}

	async login(): Promise<void> {
		let response: Response;
		const { href, username, password } = this.url;
		try {
			response = await fetch(`${href}/auth/login`, {
				method: "POST",
				body: new URLSearchParams({ username, password }),
			});
		} catch (e) {
			throw new CrossSeedError(`qBittorrent login failed: ${e.message}`);
		}

		if (response.status !== 200) {
			throw new CrossSeedError(
				`qBittorrent login failed with code ${response.status}`,
			);
		}

		this.cookie = response.headers.getSetCookie()[0];
		if (!this.cookie) {
			throw new CrossSeedError(
				`qBittorrent login failed: Invalid username or password`,
			);
		}
		const version = await this.request(
			"/app/version",
			"",
			X_WWW_FORM_URLENCODED,
		);
		if (!version) {
			throw new CrossSeedError(
				`qBittorrent login failed: Unable to retrieve version`,
			);
		}
		this.version = version;
		this.versionMajor = extractInt(this.version);
		logger.info({
			label: Label.QBITTORRENT,
			message: `Logged in to qBittorrent ${this.version}`,
		});
	}

	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		await this.login();
		await this.createTag();

		if (!torrentDir) return;
		const { resume_data_storage_type } = await this.getPreferences();
		if (resume_data_storage_type === "SQLite") {
			throw new CrossSeedError(
				"torrentDir is not compatible with SQLite mode in qBittorrent, use: https://www.cross-seed.org/docs/basics/options#useclienttorrents",
			);
		}
		if (!readdirSync(torrentDir).some((f) => f.endsWith(".fastresume"))) {
			throw new CrossSeedError(
				"Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir",
			);
		}
	}

	private async request(
		path: string,
		body: BodyInit,
		headers: Record<string, string> = {},
		retries = 3,
	): Promise<string | undefined> {
		const bodyStr =
			body instanceof FormData
				? JSON.stringify(Object.fromEntries(body))
				: JSON.stringify(body).replace(
						/(?:hashes=)([a-z0-9]{40})/i,
						(match, hash) =>
							match.replace(hash, sanitizeInfoHash(hash)),
					);
		logger.verbose({
			label: Label.QBITTORRENT,
			message: `Making request (${retries}) to ${path} with body ${bodyStr}`,
		});

		let response: Response | undefined;
		try {
			response = await fetch(`${this.url.href}${path}`, {
				method: "post",
				headers: { Cookie: this.cookie, ...headers },
				body,
			});
			if (response.status === 403 && retries > 0) {
				logger.verbose({
					label: Label.QBITTORRENT,
					message:
						"Received 403 from API. Logging in again and retrying",
				});
				await this.login();
				return this.request(path, body, headers, retries - 1);
			}
		} catch (e) {
			if (retries > 0) {
				logger.verbose({
					label: Label.QBITTORRENT,
					message: `Request failed, ${retries} retries remaining: ${e.message}`,
				});
				return this.request(path, body, headers, retries - 1);
			}
			logger.verbose({
				label: Label.QBITTORRENT,
				message: `Request failed after ${retries} retries: ${e.message}`,
			});
		}
		return response?.text();
	}

	async getPreferences(): Promise<Preferences> {
		const responseText = await this.request(
			"/app/preferences",
			"",
			X_WWW_FORM_URLENCODED,
		);
		if (!responseText) {
			throw new CrossSeedError(
				`qBittorrent failed to retrieve preferences`,
			);
		}
		return JSON.parse(responseText);
	}

	private getLayoutForNewTorrent(
		searchee: Searchee,
		searcheeInfo: TorrentInfo | undefined,
		path: string | undefined,
	): string {
		return path
			? "Original"
			: this.isSubfolderContentLayout(searchee, searcheeInfo!)
				? "Subfolder"
				: "Original";
	}

	private async getCategoryForNewTorrent(
		category: string,
		savePath: string,
		autoTMM: boolean,
	): Promise<string> {
		const { duplicateCategories, linkCategory } = getRuntimeConfig();

		if (!duplicateCategories) {
			return category;
		}
		if (!category.length || category === linkCategory) {
			return category; // Use tags for category duplication if linking
		}

		const dupeCategory = category.endsWith(TORRENT_CATEGORY_SUFFIX)
			? category
			: `${category}${TORRENT_CATEGORY_SUFFIX}`;
		if (!autoTMM) return dupeCategory;

		// savePath is guaranteed to be the base category's save path due to autoTMM
		const categories = await this.getAllCategories();
		const newRes = categories.find((c) => c.name === dupeCategory);
		if (!newRes) {
			await this.createCategory(dupeCategory, savePath);
		} else if (newRes.savePath !== savePath) {
			await this.editCategory(dupeCategory, savePath);
		}
		return dupeCategory;
	}

	private getTagsForNewTorrent(
		searcheeInfo: TorrentInfo | undefined,
		path: string | undefined,
	): string {
		const { duplicateCategories, linkCategory } = getRuntimeConfig();

		if (!duplicateCategories || !searcheeInfo || !path) {
			return TORRENT_TAG; // Require path to duplicate category using tags
		}
		const searcheeCategory = searcheeInfo.category;
		if (!searcheeCategory.length || searcheeCategory === linkCategory) {
			return TORRENT_TAG;
		}

		if (searcheeCategory.endsWith(TORRENT_CATEGORY_SUFFIX)) {
			return `${TORRENT_TAG},${searcheeCategory}`;
		}
		return `${TORRENT_TAG},${searcheeCategory}${TORRENT_CATEGORY_SUFFIX}`;
	}

	async createTag(): Promise<void> {
		await this.request(
			"/torrents/createTags",
			`tags=${TORRENT_TAG}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	async createCategory(category: string, savePath: string): Promise<void> {
		await this.request(
			"/torrents/createCategory",
			`category=${category}&savePath=${savePath}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	async editCategory(category: string, savePath: string): Promise<void> {
		await this.request(
			"/torrents/editCategory",
			`category=${category}&savePath=${savePath}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	async getAllCategories(): Promise<CategoryInfo[]> {
		const responseText = await this.request("/torrents/categories", "");
		return responseText ? Object.values(JSON.parse(responseText)) : [];
	}

	async getFiles(infoHash: string): Promise<File[] | null> {
		const responseText = await this.request(
			"/torrents/files",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		if (!responseText) return null;
		try {
			return JSON.parse(responseText).map((file) => ({
				name: path.basename(file.name),
				path: file.name,
				length: file.size,
			}));
		} catch (e) {
			logger.debug(e);
			return null;
		}
	}

	async getTrackers(infoHash: string): Promise<string[][] | null> {
		const responseText = await this.request(
			"/torrents/trackers",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		if (!responseText) return null;
		try {
			return organizeTrackers(JSON.parse(responseText));
		} catch (e) {
			logger.debug(e);
			return null;
		}
	}

	async addTorrent(formData: FormData): Promise<void> {
		await this.request("/torrents/add", formData);
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		// Pause first as it may resume after recheck automatically
		await this.request(
			`/torrents/${this.versionMajor >= 5 ? "stop" : "pause"}`,
			`hashes=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		await this.request(
			"/torrents/recheck",
			`hashes=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	/*
	 * @param searchee the Searchee we are generating off (in client)
	 * @return either a string containing the path or a error mesage
	 */
	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		options: { onlyCompleted: boolean },
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		try {
			const torrentInfo = await this.getTorrentInfo(meta.infoHash);
			if (!torrentInfo) {
				return resultOfErr("NOT_FOUND");
			}
			if (
				options.onlyCompleted &&
				!this.isTorrentInfoComplete(torrentInfo)
			) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
			return resultOf(this.getCorrectSavePath(meta, torrentInfo));
		} catch (e) {
			logger.debug(e);
			if (e.message.includes("retrieve")) {
				return resultOfErr("NOT_FOUND");
			}
			return resultOfErr("UNKNOWN_ERROR");
		}
	}

	/*
	 * @param metas the Searchees we are generating off (in client)
	 * @return a map of infohash to path
	 */
	async getAllDownloadDirs(options: {
		metas: SearcheeWithInfoHash[] | Metafile[];
		onlyCompleted: boolean;
		v1HashOnly?: boolean;
	}): Promise<Map<string, string>> {
		const torrents = await this.getAllTorrentInfo();
		const torrentSavePaths = new Map<string, string>();
		const infoHashMetaMap = options.metas.reduce((acc, meta) => {
			acc.set(meta.infoHash, meta);
			return acc;
		}, new Map<string, SearcheeWithInfoHash | Metafile>());
		for (const torrent of torrents) {
			if (options.onlyCompleted && !this.isTorrentInfoComplete(torrent)) {
				continue;
			}
			const meta =
				infoHashMetaMap.get(torrent.hash) ||
				(torrent.infohash_v2 &&
					infoHashMetaMap.get(torrent.infohash_v2)) ||
				(torrent.infohash_v1 &&
					infoHashMetaMap.get(torrent.infohash_v1)) ||
				undefined;
			const savePath = meta
				? this.getCorrectSavePath(meta, torrent)
				: torrent.save_path;
			if (torrent.infohash_v1?.length) {
				torrentSavePaths.set(torrent.infohash_v1, savePath);
			}
			if (options.v1HashOnly) continue;
			torrentSavePaths.set(torrent.hash, savePath);
			if (torrent.infohash_v2?.length) {
				torrentSavePaths.set(torrent.infohash_v2, savePath);
			}
		}
		return torrentSavePaths;
	}

	/*
	 * @param searchee the Searchee we are generating off (in client)
	 * @param torrentInfo the torrent info from the searchee
	 * @return string absolute location from client with content layout considered
	 */
	getCorrectSavePath(
		data: Searchee | Metafile,
		torrentInfo: TorrentInfo,
	): string {
		const subfolderContentLayout = this.isSubfolderContentLayout(
			data,
			torrentInfo,
		);
		if (subfolderContentLayout) {
			return ABS_WIN_PATH_REGEX.test(torrentInfo.content_path)
				? path.win32.dirname(torrentInfo.content_path)
				: path.posix.dirname(torrentInfo.content_path);
		}
		return torrentInfo.save_path;
	}

	/*
	 * @return array of all torrents in the client
	 */
	async getAllTorrentInfo(): Promise<TorrentInfo[]> {
		const responseText = await this.request("/torrents/info", "");
		if (!responseText) {
			return [];
		}
		return JSON.parse(responseText);
	}

	/*
	 * @param hash the hash of the torrent
	 * @return the torrent if it exists
	 */
	async getTorrentInfo(
		hash: string | undefined,
		retries = 0,
	): Promise<TorrentInfo | undefined> {
		if (!hash) return undefined;
		for (let i = 0; i <= retries; i++) {
			const responseText = await this.request(
				"/torrents/info",
				`hashes=${hash}`,
				X_WWW_FORM_URLENCODED,
			);
			if (responseText) {
				const torrents = JSON.parse(responseText) as TorrentInfo[];
				if (torrents.length > 0) {
					return torrents[0];
				}
			}
			const torrents = await this.getAllTorrentInfo();
			const torrentInfo = torrents.find(
				(torrent) =>
					hash === torrent.hash ||
					hash === torrent.infohash_v1 ||
					hash === torrent.infohash_v2,
			);
			if (torrentInfo) {
				return torrentInfo;
			}
			if (i < retries) {
				await wait(ms("1 second") * 2 ** i);
			}
		}
		return undefined;
	}

	/**
	 * @return array of all torrents in the client
	 */
	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const torrents = await this.getAllTorrentInfo();
		return torrents.map((torrent) => ({
			infoHash: torrent.hash,
			category: torrent.category,
			tags: torrent.tags.length ? torrent.tags.split(",") : [],
			trackers: torrent.tracker.length ? [torrent.tracker] : undefined,
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
		return withMutex(
			Mutex.QUERY_CLIENT,
			async () => {
				const searchees: SearcheeClient[] = [];
				const newSearchees: SearcheeClient[] = [];
				const infoHashes = new Set<string>();
				const torrents = await this.getAllTorrentInfo();
				if (!torrents.length) {
					logger.error({
						label: Label.QBITTORRENT,
						message: "No torrents found in client",
					});
					return { searchees, newSearchees };
				}
				for (const torrent of torrents) {
					const infoHash = (
						torrent.infohash_v1 || torrent.hash
					).toLowerCase();
					infoHashes.add(infoHash);
					const dbTorrent = await memDB("torrent")
						.where("info_hash", infoHash)
						.first();
					const refresh =
						options?.refresh === undefined
							? false
							: options.refresh.length === 0
								? true
								: options.refresh.includes(infoHash);
					if (dbTorrent && !refresh) {
						if (!options?.newSearcheesOnly) {
							searchees.push(createSearcheeFromDB(dbTorrent));
						}
						continue;
					}
					const files = await this.getFiles(torrent.hash);
					if (!files) {
						logger.verbose({
							label: Label.QBITTORRENT,
							message: `Failed to get files for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}] (likely transient)`,
						});
						continue;
					}
					if (!files.length) {
						logger.verbose({
							label: Label.QBITTORRENT,
							message: `No files found for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}]: skipping`,
						});
						continue;
					}
					const trackers = await this.getTrackers(torrent.hash);
					if (!trackers) {
						logger.verbose({
							label: Label.QBITTORRENT,
							message: `Failed to get trackers for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}] (likely transient)`,
						});
						continue;
					}
					const { name } = torrent;
					const title = parseTitle(name, files) ?? name;
					const length = torrent.total_size;
					const savePath = torrent.save_path;
					const category = torrent.category;
					const tags = torrent.tags.length
						? torrent.tags.split(",")
						: [];
					const searchee: SearcheeClient = {
						infoHash,
						name,
						title,
						files,
						length,
						savePath,
						category,
						tags,
						trackers,
					};
					newSearchees.push(searchee);
					searchees.push(searchee);
				}
				await updateSearcheeClientDB(newSearchees, infoHashes);
				return { searchees, newSearchees };
			},
			{ useQueue: true },
		);
	}

	/**
	 * @param infoHash the infohash of the torrent
	 * @returns whether the torrent is complete
	 */
	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const torrentInfo = await this.getTorrentInfo(infoHash);
		if (!torrentInfo) {
			return resultOfErr("NOT_FOUND");
		}
		return resultOf(this.isTorrentInfoComplete(torrentInfo));
	}

	isTorrentInfoComplete(torrentInfo: TorrentInfo): boolean {
		return [
			"uploading",
			"pausedUP",
			"stoppedUP",
			"queuedUP",
			"stalledUP",
			"checkingUP",
			"forcedUP",
		].includes(torrentInfo.state);
	}

	isSubfolderContentLayout(
		data: Searchee | Metafile,
		dataInfo: TorrentInfo,
	): boolean {
		if (data.files.length > 1) return false;
		if (path.dirname(data.files[0].path) !== ".") return false;
		let dirname = path.posix.dirname;
		let resolve = path.posix.resolve;
		if (ABS_WIN_PATH_REGEX.test(dataInfo.content_path)) {
			dirname = path.win32.dirname;
			resolve = path.win32.resolve;
		}
		return (
			resolve(dirname(dataInfo.content_path)) !==
			resolve(dataInfo.save_path)
		);
	}

	async resumeInjection(
		infoHash: string,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	): Promise<void> {
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
			const torrentInfo = await this.getTorrentInfo(infoHash);
			if (!torrentInfo) {
				sleepTime = resumeErrSleepTime; // Dropping connections or restart
				continue;
			}
			if (["checkingDL", "checkingUP"].includes(torrentInfo.state)) {
				continue;
			}
			const torrentLog = `${torrentInfo.name} [${sanitizeInfoHash(infoHash)}]`;
			if (
				!["pausedDL", "stoppedDL", "pausedUP", "stoppedUP"].includes(
					torrentInfo.state,
				)
			) {
				logger.warn({
					label: Label.QBITTORRENT,
					message: `Will not resume ${torrentLog}: state is ${torrentInfo.state}`,
				});
				return;
			}
			if (torrentInfo.amount_left > maxRemainingBytes) {
				logger.warn({
					label: Label.QBITTORRENT,
					message: `Will not resume ${torrentLog}: ${humanReadableSize(torrentInfo.amount_left, { binary: true })} remaining > ${humanReadableSize(maxRemainingBytes, { binary: true })}`,
				});
				return;
			}
			logger.info({
				label: Label.QBITTORRENT,
				message: `Resuming ${torrentLog}: ${humanReadableSize(torrentInfo.amount_left, { binary: true })} remaining`,
			});
			await this.request(
				`/torrents/${this.versionMajor >= 5 ? "start" : "resume"}`,
				`hashes=${infoHash}`,
				X_WWW_FORM_URLENCODED,
			);
			return;
		}
		logger.warn({
			label: Label.QBITTORRENT,
			message: `Will not resume torrent ${infoHash}: timeout`,
		});
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		path?: string,
	): Promise<InjectionResult> {
		const { linkCategory } = getRuntimeConfig();
		try {
			if (await this.getTorrentInfo(newTorrent.infoHash)) {
				return InjectionResult.ALREADY_EXISTS;
			}
			const searcheeInfo = await this.getTorrentInfo(searchee.infoHash);
			if (!searcheeInfo) {
				if (!path) {
					// This is never possible, being made explicit here
					throw new Error(
						`Searchee torrent may have been deleted: ${getLogString(searchee)}`,
					);
				} else if (searchee.infoHash) {
					logger.warn({
						label: Label.QBITTORRENT,
						message: `Searchee torrent may have been deleted, tagging may not meet expectations: ${getLogString(searchee)}`,
					});
				}
			}

			const { savePath, isComplete, autoTMM, category } = path
				? {
						savePath: path,
						isComplete: true,
						autoTMM: false,
						category: linkCategory,
					}
				: {
						savePath: searcheeInfo!.save_path,
						isComplete: this.isTorrentInfoComplete(searcheeInfo!),
						autoTMM: searcheeInfo!.auto_tmm,
						category: searcheeInfo!.category,
					};
			if (!isComplete) return InjectionResult.TORRENT_NOT_COMPLETE;
			const filename = `${newTorrent.getFileSystemSafeName()}.${TORRENT_TAG}.torrent`;
			const buffer = new Blob([newTorrent.encode()], {
				type: "application/x-bittorrent",
			});
			const toRecheck = shouldRecheck(searchee, decision);

			// ---------------------- Building form data ----------------------
			const formData = new FormData();
			formData.append("torrents", buffer, filename);
			if (!autoTMM) {
				formData.append("downloadPath", savePath);
				formData.append("savepath", savePath);
			}
			formData.append("autoTMM", autoTMM.toString());
			if (category?.length) {
				formData.append(
					"category",
					await this.getCategoryForNewTorrent(
						category,
						savePath,
						autoTMM,
					),
				);
			}
			formData.append(
				"tags",
				this.getTagsForNewTorrent(searcheeInfo, path),
			);
			formData.append(
				"contentLayout",
				this.getLayoutForNewTorrent(searchee, searcheeInfo, path),
			);
			formData.append("skip_checking", (!toRecheck).toString());
			formData.append(
				this.versionMajor >= 5 ? "stopped" : "paused",
				toRecheck.toString(),
			);
			// for some reason the parser parses the last kv pair incorrectly
			// it concats the value and the sentinel
			formData.append("foo", "bar");
			try {
				await this.addTorrent(formData);
			} catch (e) {
				logger.error({
					label: Label.QBITTORRENT,
					message: `Failed to add torrent (polling client to confirm): ${e.message}`,
				});
				logger.debug(e);
			}

			const newInfo = await this.getTorrentInfo(newTorrent.infoHash, 5);
			if (!newInfo) {
				throw new Error(`Failed to retrieve torrent after adding`);
			}
			if (toRecheck) {
				await this.recheckTorrent(newInfo.hash);
				this.resumeInjection(newInfo.hash, decision, {
					checkOnce: false,
				});
			}

			return InjectionResult.SUCCESS;
		} catch (e) {
			logger.error({
				label: Label.QBITTORRENT,
				message: `Injection failed for ${getLogString(newTorrent)}: ${e.message}`,
			});
			logger.debug(e);
			return InjectionResult.FAILURE;
		}
	}
}
