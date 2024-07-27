import { dirname, resolve } from "path";
import {
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_TAG,
	TORRENT_CATEGORY_SUFFIX,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import ms from "ms";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import {
	shouldRecheck,
	extractCredentialsFromUrl,
	wait,
	getLogString,
	sanitizeInfoHash,
} from "../utils.js";
import { TorrentClient } from "./TorrentClient.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { BodyInit } from "undici-types";

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

	async recheckTorrent(torrentInfo: TorrentInfo): Promise<void> {
		await this.request(
			"/torrents/recheck",
			`hashes=${torrentInfo.hash}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	/*
	@param searchee the Searchee we are generating off (in client)
	@return either a string containing the path or a error mesage
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
	@param searchee the Searchee we are generating off (in client)
	@param torrentInfo the torrent info from the searchee
	@return string absolute location from client with content layout considered
	 */
	getCorrectSavePath(searchee: Searchee, torrentInfo: TorrentInfo): string {
		const subfolderContentLayout = this.isSubfolderContentLayout(
			searchee,
			torrentInfo,
		);
		if (subfolderContentLayout) {
			return dirname(torrentInfo.content_path);
		}
		return torrentInfo.save_path;
	}

	/*
	@return array of all torrents in the client
	 */
	async getAllTorrentInfo(): Promise<TorrentInfo[]> {
		const responseText = await this.request("/torrents/info", "");
		if (!responseText) {
			return [];
		}
		return JSON.parse(responseText);
	}

	/*
	@param hash the hash of the torrent
	@return the torrent if it exists
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
			await wait(ms("1 second") * 2 ** i);
		}
		return undefined;
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
		searchee: Searchee,
		searcheeInfo: TorrentInfo,
	): boolean {
		if (searchee.files.length > 1) return false;
		if (dirname(searchee.files[0].path) !== ".") return false;
		return (
			resolve(dirname(searcheeInfo.content_path)) !==
			resolve(searcheeInfo.save_path)
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
					logger.warning({
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
			const toRecheck = shouldRecheck(decision);

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
			formData.append("paused", toRecheck.toString());
			// for some reason the parser parses the last kv pair incorrectly
			// it concats the value and the sentinel
			formData.append("foo", "bar");
			await this.addTorrent(formData);

			const newInfo = await this.getTorrentInfo(newTorrent.infoHash, 5);
			if (!newInfo) {
				throw new Error(`Failed to retrieve torrent after adding`);
			}
			if (toRecheck) {
				await this.recheckTorrent(newInfo);
			}

			return InjectionResult.SUCCESS;
		} catch (e) {
			logger.debug({
				label: Label.QBITTORRENT,
				message: `Injection failed: ${e.message}`,
			});
			logger.debug(e);
			return InjectionResult.FAILURE;
		}
	}
}
