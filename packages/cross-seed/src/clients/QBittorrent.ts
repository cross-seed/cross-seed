import { readdir } from "fs/promises";
import ms from "ms";
import path from "path";
import { BodyInit } from "undici-types";
import { humanReadableSize } from "@cross-seed/shared/utils";
import {
	ABS_WIN_PATH_REGEX,
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
	File,
	parseTitle,
	Searchee,
	SearcheeClient,
	SearcheeWithInfoHash,
	updateSearcheeClientDB,
} from "../searchee.js";
import {
	extractCredentialsFromUrl,
	extractInt,
	getLogString,
	getPathParts,
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
	comment?: string;
	completed: number;
	completion_on: number;
	connections_count?: number;
	connections_limit?: number;
	content_path: string;
	created_by?: string;
	creation_date?: number;
	dl_limit: number;
	dlspeed: number;
	download_path?: string;
	downloaded: number;
	downloaded_session: number;
	eta: number;
	f_l_piece_prio: boolean;
	files?: TorrentFile[];
	force_start: boolean;
	has_metadata?: boolean;
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
	piece_size?: number;
	pieces_have?: number;
	pieces_num?: number;
	popularity?: number;
	priority: number;
	private?: boolean;
	progress: number;
	ratio: number;
	ratio_limit: number;
	reannounce?: number;
	root_path?: string;
	save_path: string;
	seeding_time: number;
	seeding_time_limit: number;
	seen_complete: number;
	seq_dl: boolean;
	size: number;
	state:
		| "error"
		| "missingFiles"
		| "uploading"
		| "pausedUP"
		| "stoppedUP"
		| "queuedUP"
		| "stalledUP"
		| "checkingUP"
		| "forcedUP"
		| "allocating"
		| "downloading"
		| "metaDL"
		| "pausedDL"
		| "stoppedDL"
		| "queuedDL"
		| "stalledDL"
		| "checkingDL"
		| "forcedDL"
		| "checkingResumeData"
		| "moving"
		| "unknown";
	super_seeding: boolean;
	tags: string;
	time_active: number;
	total_size: number;
	total_wasted?: number;
	tracker: string;
	trackers?: TorrentTracker[];
	trackers_count?: number;
	up_limit: number;
	uploaded: number;
	uploaded_session: number;
	upspeed: number;
}

interface TorrentTracker {
	msg: string;
	num_downloaded: number;
	num_leeches: number;
	num_peers: number;
	num_seeds: number;
	status: 0 | 1 | 2 | 3 | 4;
	tier: number;
	url: string;
}

interface TorrentFile {
	availability: number;
	index?: number;
	is_seed: boolean;
	name: string;
	piece_range: [number, number];
	priority: 0 | 1 | 6 | 7;
	progress: number;
	size: number;
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
	versionMinor: number;
	versionPatch: number;
	readonly clientHost: string;
	readonly clientPriority: number;
	readonly clientType = Label.QBITTORRENT;
	readonly readonly: boolean;
	readonly label: string;

	constructor(
		url: string,
		clientHost: string,
		priority: number,
		readonly: boolean,
	) {
		this.clientHost = clientHost;
		this.clientPriority = priority;
		this.readonly = readonly;
		this.label = `${this.clientType}@${this.clientHost}`;
		this.url = extractCredentialsFromUrl(url, "/api/v2").unwrapOrThrow(
			new CrossSeedError(
				`[${this.label}] qBittorrent url must be percent-encoded`,
			),
		);
	}

	async login(): Promise<void> {
		let response: Response;
		const { href, username, password } = this.url;
		try {
			response = await fetch(`${href}/auth/login`, {
				method: "POST",
				body: new URLSearchParams({ username, password }),
				headers: { "User-Agent": USER_AGENT },
				signal: AbortSignal.timeout(ms("10 seconds")),
			});
		} catch (e) {
			throw new CrossSeedError(`qBittorrent login failed: ${e.message}`);
		}

		if (response.status < 200 || response.status > 299 ) {
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
		this.versionMinor = extractInt(this.version.split(".")[1]);
		this.versionPatch = extractInt(this.version.split(".")[2]);
		if (
			this.versionMajor < 4 ||
			(this.versionMajor === 4 && this.versionMinor < 3) ||
			(this.versionMajor === 4 &&
				this.versionMinor === 3 &&
				this.versionPatch < 1)
		) {
			throw new CrossSeedError(
				`qBittorrent minimum supported version is v4.3.1, current version is ${this.version}`,
			);
		}
		logger.info({
			label: this.label,
			message: `Logged in to ${this.version} successfully${this.readonly ? " (readonly)" : ""}`,
		});
	}

	async validateConfig(): Promise<void> {
		const { torrentDir } = getRuntimeConfig();
		try {
			await this.login();
		} catch (e) {
			e.message = `[${this.label}] ${e.message}`;
			throw e;
		}
		await this.createTag();

		if (!torrentDir) return;
		const { resume_data_storage_type } = await this.getPreferences();
		if (resume_data_storage_type === "SQLite") {
			throw new CrossSeedError(
				`[${this.label}] torrentDir is not compatible with SQLite mode in qBittorrent, use https://www.cross-seed.org/docs/basics/options#useclienttorrents`,
			);
		}
		if (
			!(await readdir(torrentDir)).some((f) => f.endsWith(".fastresume"))
		) {
			throw new CrossSeedError(
				`[${this.label}] Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir`,
			);
		}
	}

	private async request(
		path: string,
		body: BodyInit,
		headers: Record<string, string> = {},
		numRetries = 3,
	): Promise<string | undefined> {
		const bodyStr =
			body instanceof URLSearchParams || body instanceof FormData
				? JSON.stringify(Object.fromEntries(body))
				: JSON.stringify(body).replace(
						/(?:hash(?:es)?=)([a-z0-9]{40})/i,
						(match, hash) =>
							match.replace(hash, sanitizeInfoHash(hash)),
					);

		let response: Response | undefined;
		const retries = Math.max(numRetries, 0);
		for (let i = 0; i <= retries; i++) {
			try {
				logger.verbose({
					label: this.label,
					message: `Making request (${retries - i}) to ${path} with body ${bodyStr}`,
				});
				response = await fetch(`${this.url.href}${path}`, {
					method: "POST",
					headers: {
						Cookie: this.cookie,
						"User-Agent": USER_AGENT,
						...headers,
					},
					body,
					signal: AbortSignal.timeout(ms("10 minutes")),
				});
				if (response.status === 403) {
					if (i >= retries) {
						logger.error({
							label: this.label,
							message: `Received 403 from API after ${retries} retries`,
						});
						break;
					}
					logger.verbose({
						label: this.label,
						message: `Received 403 from API, re-authenticating and retrying (${retries - i} retries left)`,
					});
					await this.login();
					await wait(
						Math.min(ms("1 second") * 2 ** i, ms("10 seconds")),
					);
					continue;
				}
				if (response.status >= 500 && response.status < 600) {
					if (i >= retries) {
						logger.error({
							label: this.label,
							message: `Received ${response.status} from API after ${retries} retries`,
						});
						break;
					}
					logger.verbose({
						label: this.label,
						message: `Received ${response.status} from API, ${retries - i} retries remaining`,
					});
					await wait(
						Math.min(ms("1 second") * 2 ** i, ms("10 seconds")),
					);
					continue;
				}
				break;
			} catch (e) {
				if (i >= retries) {
					logger.error({
						label: this.label,
						message: `Request failed after ${retries} retries: ${e.message}`,
					});
					logger.debug(e);
					break;
				}
				logger.verbose({
					label: this.label,
					message: `Request failed, ${retries - i} retries remaining: ${e.message}`,
				});
				await wait(Math.min(ms("1 second") * 2 ** i, ms("10 seconds")));
				continue;
			}
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
				`[${this.label}] qBittorrent failed to retrieve preferences`,
			);
		}
		return JSON.parse(responseText);
	}

	/**
	 * Always returns "Original" for API searchees due to isSubfolderContentLayout.
	 * This is not an issue since it's either a MATCH or we are linking.
	 * @param searchee the Searchee the match was sourced from
	 * @param searcheeInfo the torrent info from the searchee
	 * @param destinationDir the destinationDir for the new torrent
	 * @returns the layout to use for the new torrent
	 */
	private getLayoutForNewTorrent(
		searchee: Searchee,
		searcheeInfo: TorrentInfo | undefined,
		destinationDir: string | undefined,
	): string {
		return destinationDir
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
		destinationDir: string | undefined,
	): string {
		const { duplicateCategories, linkCategory } = getRuntimeConfig();

		if (!duplicateCategories || !searcheeInfo || !destinationDir) {
			return TORRENT_TAG; // Require destinationDir to duplicate category using tags
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

	torrentFileToFile(torrentFile: TorrentFile): File {
		return {
			name: path.basename(torrentFile.name),
			path: torrentFile.name,
			length: torrentFile.size,
		};
	}

	async getFiles(infoHash: string): Promise<File[] | null> {
		const responseText = await this.request(
			"/torrents/files",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		if (!responseText) return null;
		try {
			const files: TorrentFile[] = JSON.parse(responseText);
			return files.map(this.torrentFileToFile);
		} catch (e) {
			logger.debug({ label: this.label, message: e });
			return null;
		}
	}

	async getTrackers(infoHash: string): Promise<string[] | null> {
		const responseText = await this.request(
			"/torrents/trackers",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		if (!responseText) return null;
		try {
			const trackers: TorrentTracker[] = JSON.parse(responseText);
			return organizeTrackers(trackers);
		} catch (e) {
			logger.debug({ label: this.label, message: e });
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
		Result<
			string,
			| "NOT_FOUND"
			| "TORRENT_NOT_COMPLETE"
			| "INVALID_DATA"
			| "UNKNOWN_ERROR"
		>
	> {
		const { torrentDir } = getRuntimeConfig();
		try {
			const torrentInfo = await this.getTorrentInfo(meta.infoHash);
			if (!torrentInfo) {
				return resultOfErr("NOT_FOUND");
			}
			if (
				torrentDir &&
				this.isNoSubfolderContentLayout(meta, torrentInfo)
			) {
				logger.error({
					label: this.label,
					message: `NoSubfolder content layout is not supported with torrentDir, use https://www.cross-seed.org/docs/basics/options#useclienttorrents: ${torrentInfo.name} [${sanitizeInfoHash(torrentInfo.hash)}]`,
				});
				return resultOfErr("INVALID_DATA");
			}
			if (
				options.onlyCompleted &&
				!this.isTorrentInfoComplete(torrentInfo)
			) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
			return resultOf(this.getCorrectSavePath(meta, torrentInfo));
		} catch (e) {
			logger.debug({ label: this.label, message: e });
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
		const { torrentDir } = getRuntimeConfig();
		const torrents = await this.getAllTorrentInfo();
		const torrentSavePaths = new Map<string, string>();
		const infoHashMetaMap = options.metas.reduce((acc, meta) => {
			acc.set(meta.infoHash, meta);
			return acc;
		}, new Map<string, SearcheeWithInfoHash | Metafile>());
		for (const torrent of torrents) {
			const meta =
				infoHashMetaMap.get(torrent.hash) ||
				(torrent.infohash_v2 &&
					infoHashMetaMap.get(torrent.infohash_v2)) ||
				(torrent.infohash_v1 &&
					infoHashMetaMap.get(torrent.infohash_v1)) ||
				undefined;
			if (
				torrentDir &&
				meta &&
				this.isNoSubfolderContentLayout(meta, torrent)
			) {
				throw new CrossSeedError(
					`[${this.label}] NoSubfolder content layout is not supported with torrentDir, use https://www.cross-seed.org/docs/basics/options#useclienttorrents: ${torrent.name} [${sanitizeInfoHash(torrent.hash)}]`,
				);
			}
			if (options.onlyCompleted && !this.isTorrentInfoComplete(torrent)) {
				continue;
			}
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
	async getAllTorrentInfo(options?: {
		includeFiles?: boolean;
		includeTrackers?: boolean;
	}): Promise<TorrentInfo[]> {
		const params = new URLSearchParams();
		if (options?.includeFiles) params.append("includeFiles", "true");
		if (options?.includeTrackers) params.append("includeTrackers", "true");
		const responseText = await this.request("/torrents/info", params);
		if (!responseText) return [];
		return JSON.parse(responseText);
	}

	/*
	 * @param hash the hash of the torrent
	 * @return the torrent if it exists
	 */
	async getTorrentInfo(
		hash: string | undefined,
		numRetries = 0,
	): Promise<TorrentInfo | undefined> {
		if (!hash) return undefined;
		const retries = Math.max(numRetries, 0);
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
				await wait(Math.min(ms("1 second") * 2 ** i, ms("10 seconds")));
			}
		}
		return undefined;
	}

	/**
	 * @return array of all torrents in the client
	 */
	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const torrents = await this.getAllTorrentInfo({
			includeTrackers: true,
		});
		return torrents.map((torrent) => ({
			infoHash: torrent.hash,
			category: torrent.category,
			tags: torrent.tags.length ? torrent.tags.split(",") : [],
			trackers: torrent.trackers
				? organizeTrackers(torrent.trackers)
				: torrent.tracker.length
					? [torrent.tracker]
					: undefined,
		}));
	}

	/**
	 * Get all searchees from the client and update the db
	 * @param options.newSearcheesOnly only return searchees that are not in the db
	 * @param options.refresh undefined uses the cache, [] refreshes all searchees, or a list of infoHashes to refresh
	 * @param options.includeFiles include files in the torrents info request
	 * @param options.includeTrackers include trackers in the torrents info request
	 * @return an object containing all searchees and new searchees (refreshed searchees are considered new)
	 */
	async getClientSearchees(options?: {
		newSearcheesOnly?: boolean;
		refresh?: string[];
		includeFiles?: boolean;
		includeTrackers?: boolean;
	}): Promise<ClientSearcheeResult> {
		const searchees: SearcheeClient[] = [];
		const newSearchees: SearcheeClient[] = [];
		const infoHashes = new Set<string>();
		const torrents = await this.getAllTorrentInfo({
			includeFiles: options?.includeFiles,
			includeTrackers: options?.includeTrackers,
		});
		if (!torrents.length) {
			logger.error({
				label: this.label,
				message: "No torrents found in client",
			});
			return { searchees, newSearchees };
		}
		for (const torrent of torrents) {
			const infoHash = (
				torrent.infohash_v1 || torrent.hash
			).toLowerCase();
			infoHashes.add(infoHash);
			const dbTorrent = await db("client_searchee")
				.where("info_hash", infoHash)
				.where("client_host", this.clientHost)
				.first();
			const { name } = torrent;
			const savePath = torrent.save_path;
			const category = torrent.category;
			const tags = torrent.tags.length
				? torrent.tags
						.split(",")
						.map((tag) => tag.trim())
						.filter((tag) => tag.length)
				: [];
			const modified = clientSearcheeModified(
				this.label,
				dbTorrent,
				name,
				savePath,
				{
					category,
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
			const files =
				torrent.files?.map(this.torrentFileToFile) ??
				(await this.getFiles(torrent.hash));
			if (!files) {
				logger.verbose({
					label: this.label,
					message: `Failed to get files for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}] (likely transient)`,
				});
				continue;
			}
			if (!files.length) {
				logger.verbose({
					label: this.label,
					message: `No files found for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}]: skipping`,
				});
				continue;
			}
			const trackers = torrent.trackers
				? organizeTrackers(torrent.trackers)
				: await this.getTrackers(torrent.hash);
			if (!trackers) {
				logger.verbose({
					label: this.label,
					message: `Failed to get trackers for ${torrent.name} [${sanitizeInfoHash(torrent.hash)}] (likely transient)`,
				});
				continue;
			}
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
				tags,
				trackers,
			};
			newSearchees.push(searchee);
			searchees.push(searchee);
		}
		await updateSearcheeClientDB(this.clientHost, newSearchees, infoHashes);
		return { searchees, newSearchees };
	}

	/**
	 * @param inputHash the infohash of the torrent
	 * @returns whether the torrent is in client
	 */
	async isTorrentInClient(
		inputHash: string,
	): Promise<Result<boolean, Error>> {
		const infoHash = inputHash.toLowerCase();
		try {
			const torrents = await this.getAllTorrentInfo();
			if (!torrents.length) throw new Error("No torrents found");
			for (const torrent of torrents) {
				if (
					torrent.hash.toLowerCase() === infoHash ||
					torrent.infohash_v1?.toLowerCase() === infoHash ||
					torrent.infohash_v2?.toLowerCase() === infoHash
				) {
					return resultOf(true);
				}
			}
			return resultOf(false);
		} catch (e) {
			return resultOfErr(e);
		}
	}

	/**
	 * @param infoHash the infohash of the torrent
	 * @returns whether the torrent is complete
	 */
	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const torrentInfo = await this.getTorrentInfo(infoHash);
		if (!torrentInfo) return resultOfErr("NOT_FOUND");
		return resultOf(this.isTorrentInfoComplete(torrentInfo));
	}

	/**
	 * @param infoHash the infohash of the torrent
	 * @returns whether the torrent is checking
	 */
	async isTorrentChecking(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const torrentInfo = await this.getTorrentInfo(infoHash);
		if (!torrentInfo) return resultOfErr("NOT_FOUND");
		return resultOf(
			["checkingDL", "checkingUP"].includes(torrentInfo.state),
		);
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

	/**
	 * This can only return true if the searchee is from a torrent file, not API.
	 * Since we get the file structure from the API, it's already accounted for.
	 * This does NOT check if the torrent was added with "Don't Create Subfolder".
	 * @param data the Searchee or Metafile
	 * @param dataInfo the TorrentInfo
	 * @returns whether the torrent was added with "Create Subfolder"
	 */
	isSubfolderContentLayout(
		data: Searchee | Metafile,
		dataInfo: TorrentInfo,
	): boolean {
		const { useClientTorrents } = getRuntimeConfig();
		if (useClientTorrents) return false;
		if (data.files.length > 1) return false;
		let dirname = path.posix.dirname;
		let resolve = path.posix.resolve;
		if (ABS_WIN_PATH_REGEX.test(dataInfo.content_path)) {
			dirname = path.win32.dirname;
			resolve = path.win32.resolve;
		}
		if (dirname(data.files[0].path) !== ".") return false;
		return (
			resolve(dirname(dataInfo.content_path)) !==
			resolve(dataInfo.save_path)
		);
	}

	/**
	 * This can only return true if the searchee is from a torrent file, not API.
	 * Since we get the file structure from the API, it's already accounted for.
	 * This does NOT check if the torrent was added with "Create Subfolder".
	 * @param data the Searchee or Metafile
	 * @param dataInfo the TorrentInfo
	 * @returns whether the torrent was added with "Don't Create Subfolder"
	 */
	isNoSubfolderContentLayout(
		data: Searchee | Metafile,
		dataInfo: TorrentInfo,
	): boolean {
		const { useClientTorrents } = getRuntimeConfig();
		if (useClientTorrents) return false;
		if (data.files.length > 1) {
			return dataInfo.content_path === dataInfo.save_path;
		}
		let dirname = path.posix.dirname;
		let relative = path.posix.relative;
		if (ABS_WIN_PATH_REGEX.test(dataInfo.content_path)) {
			dirname = path.win32.dirname;
			relative = path.win32.relative;
		}
		if (dirname(data.files[0].path) === ".") return false;
		const clientPath = relative(dataInfo.save_path, dataInfo.content_path);
		return (
			getPathParts(clientPath, dirname).length <
			getPathParts(data.files[0].path, dirname).length
		);
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
					label: this.label,
					message: `Will not resume ${torrentLog}: state is ${torrentInfo.state}`,
				});
				return;
			}
			const maxRemainingBytes = getMaxRemainingBytes(meta, decision, {
				torrentLog,
				label: this.label,
			});
			if (torrentInfo.amount_left > maxRemainingBytes) {
				if (
					!shouldResumeFromNonRelevantFiles(
						meta,
						torrentInfo.amount_left,
						decision,
						{ torrentLog, label: this.label },
					)
				) {
					logger.warn({
						label: this.label,
						message: `autoResumeMaxDownload will not resume ${torrentLog}: remainingSize ${humanReadableSize(torrentInfo.amount_left, { binary: true })} > ${humanReadableSize(maxRemainingBytes, { binary: true })} limit`,
					});
					return;
				}
			}
			logger.info({
				label: this.label,
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
		const { linkCategory } = getRuntimeConfig();
		try {
			const existsRes = await this.isTorrentInClient(newTorrent.infoHash);
			if (existsRes.isErr()) return InjectionResult.FAILURE;
			if (existsRes.unwrap()) return InjectionResult.ALREADY_EXISTS;
			const searcheeInfo = await this.getTorrentInfo(searchee.infoHash);
			if (!searcheeInfo) {
				if (!options.destinationDir) {
					// This is never possible, being made explicit here
					throw new Error(
						`Searchee torrent may have been deleted: ${getLogString(searchee)}`,
					);
				} else if (searchee.infoHash) {
					logger.warn({
						label: this.label,
						message: `Searchee torrent may have been deleted, tagging may not meet expectations: ${getLogString(searchee)}`,
					});
				}
			}

			const { savePath, isComplete, autoTMM, category } =
				options.destinationDir
					? {
							savePath: options.destinationDir,
							isComplete: true,
							autoTMM: false,
							category: linkCategory,
						}
					: {
							savePath: searcheeInfo!.save_path,
							isComplete: this.isTorrentInfoComplete(
								searcheeInfo!,
							),
							autoTMM: searcheeInfo!.auto_tmm,
							category: searcheeInfo!.category,
						};
			if (options.onlyCompleted && !isComplete) {
				return InjectionResult.TORRENT_NOT_COMPLETE;
			}
			const filename = `${newTorrent.getFileSystemSafeName()}.${TORRENT_TAG}.torrent`;
			const buffer = new Blob([new Uint8Array(newTorrent.encode())], {
				type: "application/x-bittorrent",
			});
			const toRecheck = shouldRecheck(newTorrent, decision);

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
				this.getTagsForNewTorrent(searcheeInfo, options.destinationDir),
			);
			formData.append(
				"contentLayout",
				this.getLayoutForNewTorrent(
					searchee,
					searcheeInfo,
					options.destinationDir,
				),
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
					label: this.label,
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
				void this.resumeInjection(newTorrent, decision, {
					checkOnce: false,
				});
			}

			return InjectionResult.SUCCESS;
		} catch (e) {
			logger.error({
				label: this.label,
				message: `Injection failed for ${getLogString(newTorrent)}: ${e.message}`,
			});
			logger.debug(e);
			return InjectionResult.FAILURE;
		}
	}
}
