import { dirname } from "path";
import {
	Decision,
	InjectionResult,
	TORRENT_TAG,
	TORRENT_CATEGORY_SUFFIX,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import {
	determineSkipRecheck,
	extractCredentialsFromUrl,
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
	download_path: string;
	downloaded: number;
	downloaded_session: number;
	eta: number;
	f_l_piece_prio: boolean;
	force_start: boolean;
	hash: string;
	infohash_v1: string;
	infohash_v2: string;
	last_activity: number;
	magnet_uri: string;
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
	trackers_count: number;
	up_limit: number;
	uploaded: number;
	uploaded_session: number;
	upspeed: number;
}

interface TorrentFiles {
	availability: number;
	index: number;
	is_seed: boolean;
	name: string;
	piece_range: [number, number];
	priority: number;
	progress: number;
	size: number;
}

interface TorrentConfiguration {
	save_path: string;
	isComplete: boolean;
	autoTMM: boolean;
	category: string;
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
		retries = 1,
	): Promise<string> {
		logger.verbose({
			label: Label.QBITTORRENT,
			message: `Making request to ${path} with body ${body!.toString()}`,
		});

		const response = await fetch(`${this.url.href}${path}`, {
			method: "post",
			headers: { Cookie: this.cookie, ...headers },
			body,
		});
		if (response.status === 403 && retries > 0) {
			logger.verbose({
				label: Label.QBITTORRENT,
				message: "received 403 from API. Logging in again and retrying",
			});
			await this.login();
			return this.request(path, body, headers, retries - 1);
		}
		return response.text();
	}

	private getTagsForNewTorrent(
		searchee: Searchee,
		injectionConfiguration: TorrentConfiguration,
	): string {
		const { duplicateCategories } = getRuntimeConfig();
		const { category } = injectionConfiguration;

		if (!category) {
			return TORRENT_TAG;
		}
		if (category.endsWith(TORRENT_CATEGORY_SUFFIX)) {
			return `${category},${TORRENT_TAG}`;
		}

		if (searchee.path) {
			return `${TORRENT_TAG}-data,${TORRENT_TAG}`;
		} else {
			const suffix = duplicateCategories ? TORRENT_CATEGORY_SUFFIX : "";
			return `${category}${suffix},${TORRENT_TAG}`;
		}
	}

	async createTag(): Promise<void> {
		await this.request(
			"/torrents/createTags",
			`tags=${TORRENT_TAG}`,
			X_WWW_FORM_URLENCODED,
		);
	}

	async isInfoHashInClient(infoHash: string): Promise<boolean> {
		const responseText = await this.request(
			"/torrents/properties",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED,
		);
		try {
			const properties = JSON.parse(responseText);
			return properties && typeof properties === "object";
		} catch (e) {
			return false;
		}
	}

	/*
	@param searchee the Searchee we are generating off (in client)
	@return either a string containing the path or a error mesage
	*/
	async getDownloadDir(
		searchee: SearcheeWithInfoHash,
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		try {
			const result = await this.getTorrentInfo(searchee.infoHash);
			if (result.length === 0) {
				return resultOfErr("NOT_FOUND");
			}
			const torrentInfo = result[0];
			const savePath = await this.generateCorrectSavePath(
				searchee,
				torrentInfo,
			);
			return resultOf(savePath);
		} catch (e) {
			if (e.message.includes("retrieve")) {
				return resultOfErr("NOT_FOUND");
			}
			return resultOfErr("UNKNOWN_ERROR");
		}
	}

	/*
	@param searchee the Searchee we are generating off (in client)
	@param subfolderLayout whether it is subfolder layout or not
	@return string absolute location from client with content layout considered
	 */
	async generateCorrectSavePath(
		searchee: Searchee,
		torrentInfo: TorrentInfo,
	): Promise<string> {
		const subfolderContentLayout =
			await this.isSubfolderContentLayout(searchee, torrentInfo);
		if (subfolderContentLayout) {
			return dirname(torrentInfo.content_path);
		}
		return torrentInfo.save_path;
	}

	/*
	@param hash the hash of the torrent or undefined for all torrents
	@return array of query results
	 */
	async getTorrentInfo(hash?: string): Promise<TorrentInfo[]> {
		const responseText = await this.request("/torrents/info", "");
		const torrents = JSON.parse(responseText);
		if (hash) {
			return torrents.filter((torrent) => 
				hash === torrent.infoHash_v1 ||
				hash === torrent.infoHash_v2);
		}
		return torrents;
	}

	/*
	@param searchee the searchee we are querying about
	@return object with save_path, autoTMM, isComplete, and category from qBit
	 */
	async getTorrentConfiguration(
		searchee: Searchee,
	): Promise<TorrentConfiguration> {
		const searchResult = await this.getTorrentInfo(searchee.infoHash);
		if (searchResult.length === 0) {
			throw new Error(
				"Failed to retrieve data dir; torrent not found in client",
			);
		}

		const { progress, save_path, auto_tmm, category } = searchResult[0];
		return {
			save_path,
			isComplete: progress === 1,
			autoTMM: auto_tmm,
			category,
		};
	}

	async isSubfolderContentLayout(searchee: Searchee, torrentInfo: TorrentInfo): Promise<boolean> {
		if (searchee.files.length > 1) return false;
		if (dirname(searchee.files[0].path) !== ".") return false;
		return dirname(torrentInfo.content_path) !== torrentInfo.save_path;
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision:
			| Decision.MATCH
			| Decision.MATCH_SIZE_ONLY
			| Decision.MATCH_PARTIAL,
		path?: string,
	): Promise<InjectionResult> {
		const { flatLinking, linkCategory } = getRuntimeConfig();
		try {
			if (await this.isInfoHashInClient(newTorrent.infoHash)) {
				return InjectionResult.ALREADY_EXISTS;
			}
			const filename = `${newTorrent.getFileSystemSafeName()}.${TORRENT_TAG}.torrent`;
			const buffer = new Blob([newTorrent.encode()], {
				type: "application/x-bittorrent",
			});
			const { save_path, isComplete, autoTMM, category } = path
				? {
						save_path: path,
						isComplete: true,
						autoTMM: false,
						category: linkCategory,
					}
				: await this.getTorrentConfiguration(searchee);
			const tags = this.getTagsForNewTorrent(searchee, {
				save_path,
				isComplete,
				autoTMM,
				category,
			});

			if (!isComplete) return InjectionResult.TORRENT_NOT_COMPLETE;
			const info = await this.getTorrentInfo(searchee.infoHash);
			const contentLayout = path
				? "Original"
				: (await this.isSubfolderContentLayout(searchee, info[0]))
					? "Subfolder"
					: "Original";
			const formData = new FormData();
			formData.append("torrents", buffer, filename);

			if (path) {
				// we were provided a path, so set it
				formData.append("savepath", save_path);
			}

			formData.append(
				"autoTMM",
				flatLinking && searchee.infoHash ? autoTMM.toString() : "false",
			);
			formData.append("contentLayout", path ? "Original" : contentLayout);
			formData.append("category", category);
			formData.append("tags", tags);
			const skipRecheck = determineSkipRecheck(decision);
			formData.append("skip_checking", skipRecheck.toString());
			formData.append("paused", !skipRecheck.toString());
			// for some reason the parser parses the last kv pair incorrectly
			// it concats the value and the sentinel
			formData.append("foo", "bar");

			await this.request("/torrents/add", formData);
			//if we have a linked file and skiprecheck is false
			if (skipRecheck) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				await this.request(
					"/torrents/recheck",
					`hashes=${newTorrent.infoHash}`,
					X_WWW_FORM_URLENCODED,
				);
			}

			return InjectionResult.SUCCESS;
		} catch (e) {
			logger.debug({
				label: Label.QBITTORRENT,
				message: `injection failed: ${e.message}`,
			});
			return InjectionResult.FAILURE;
		}
	}
}
