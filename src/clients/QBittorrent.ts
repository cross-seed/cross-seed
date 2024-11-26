import ms from "ms";
import { dirname, resolve } from "path";
import { BodyInit } from "undici-types";
import {
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_CATEGORY_SUFFIX,
	TORRENT_TAG,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import {
	TorrentMetadataInClient,
	shouldRecheck,
	TorrentClient,
} from "./TorrentClient.js";
import {
	extractCredentialsFromUrl,
	extractInt,
	getLogString,
	sanitizeInfoHash,
	wait,
} from "../utils.js";

const X_WWW_FORM_URLENCODED = {
	"Content-Type": "application/x-www-form-urlencoded",
};

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

export default class QBittorrent implements TorrentClient {
	cookie: string;
	url: { username: string; password: string; href: string };
	version: string;
	versionMajor: number;
	readonly type = Label.QBITTORRENT;

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		this.url = extractCredentialsFromUrl(
			qbittorrentUrl,
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
		await this.login();
		await this.createTag();
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

	private getCategoryForNewTorrent(category: string): string {
		const { duplicateCategories, linkCategory } = getRuntimeConfig();

		if (!duplicateCategories) {
			return category;
		}
		if (!category.length || category === linkCategory) {
			return category; // Use tags for category duplication if linking
		}
		if (category.endsWith(TORRENT_CATEGORY_SUFFIX)) {
			return category;
		}

		return `${category}${TORRENT_CATEGORY_SUFFIX}`;
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
			const savePath = this.getCorrectSavePath(meta, torrentInfo);
			return resultOf(savePath);
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
	}): Promise<Map<string, string>> {
		const torrents = await this.getAllTorrentInfo();
		const torrentSavePaths = new Map<string, string>();
		const infoHashMetaMap = options.metas.reduce((acc, meta) => {
			acc.set(meta.infoHash, meta);
			return acc;
		}, new Map<string, SearcheeWithInfoHash | Metafile>());
		for (const torrent of torrents) {
			if (options.onlyCompleted && !this.isTorrentInfoComplete(torrent))
				continue;
			const meta =
				infoHashMetaMap.get(torrent.hash) ||
				(torrent.infohash_v2 &&
					infoHashMetaMap.get(torrent.infohash_v2)) ||
				(torrent.infohash_v1 &&
					infoHashMetaMap.get(torrent.infohash_v1)) ||
				undefined;
			let savePath = dirname(torrent.content_path);
			if (
				!meta ||
				!(await this.isSubfolderContentLayout(meta, torrent))
			) {
				savePath = torrent.save_path;
			}
			torrentSavePaths.set(torrent.hash, savePath);
			if (torrent.infohash_v1?.length) {
				torrentSavePaths.set(torrent.infohash_v1, savePath);
			}
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
			return dirname(torrentInfo.content_path);
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
			tags: torrent.tags.split(","),
			trackers: torrent.tracker.length ? [[torrent.tracker]] : undefined,
		}));
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
		if (dirname(data.files[0].path) !== ".") return false;
		return (
			resolve(dirname(dataInfo.content_path)) !==
			resolve(dataInfo.save_path)
		);
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
			formData.append(
				"category",
				this.getCategoryForNewTorrent(category),
			);
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
