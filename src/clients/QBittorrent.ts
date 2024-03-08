import { posix } from "path";
import { InjectionResult, TORRENT_TAG } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger, logOnce } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { extractCredentialsFromUrl } from "../utils.js";
import { TorrentClient } from "./TorrentClient.js";
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

interface Category {
	name: string;
	savePath: string;
}

export default class QBittorrent implements TorrentClient {
	cookie: string;
	url: { username: string; password: string; href: string };

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		this.url = extractCredentialsFromUrl(
			qbittorrentUrl,
			"/api/v2"
		).unwrapOrThrow(
			new CrossSeedError("qBittorrent url must be percent-encoded")
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
				`qBittorrent login failed with code ${response.status}`
			);
		}

		this.cookie = response.headers.getSetCookie()[0];
		if (!this.cookie) {
			throw new CrossSeedError(
				`qBittorrent login failed: Invalid username or password`
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
		retries = 1
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

	async setUpCrossSeedCategory(ogCategoryName: string): Promise<string> {
		if (!ogCategoryName) return "";
		if (ogCategoryName.endsWith(".cross-seed")) return ogCategoryName;

		const categoriesStr = await this.request("/torrents/categories", "");
		const categories: Record<string, Category> = JSON.parse(categoriesStr);
		const ogCategory = categories[ogCategoryName];
		const newCategoryName = `${ogCategoryName}.cross-seed`;
		const maybeNewCategory = categories[newCategoryName];

		if (!ogCategory.savePath) {
			logOnce(`qbit/cat/no-save-path/${ogCategoryName}`, () => {
				logger.warn(
					`qBittorrent category "${ogCategoryName}" has no save path. Set a save path to prevent Missing Files errors.`
				);
			});
		}

		if (maybeNewCategory?.savePath === ogCategory.savePath) {
			// setup is already complete
		} else if (maybeNewCategory) {
			await this.request(
				"/torrents/editCategory",
				`category=${newCategoryName}&savePath=${ogCategory.savePath}`,
				X_WWW_FORM_URLENCODED
			);
		} else {
			await this.request(
				"/torrents/createCategory",
				`category=${newCategoryName}&savePath=${ogCategory.savePath}`,
				X_WWW_FORM_URLENCODED
			);
		}
		return newCategoryName;
	}

	async createTag(): Promise<void> {
		await this.request(
			"/torrents/createTags",
			`tags=${TORRENT_TAG}`,
			X_WWW_FORM_URLENCODED
		);
	}

	async isInfoHashInClient(infoHash: string): Promise<boolean> {
		const responseText = await this.request(
			"/torrents/properties",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED
		);
		try {
			const properties = JSON.parse(responseText);
			return properties && typeof properties === "object";
		} catch (e) {
			return false;
		}
	}

	async getTorrentConfiguration(searchee: Searchee): Promise<{
		save_path: string;
		isComplete: boolean;
		autoTMM: boolean;
		category: string;
	}> {
		const responseText = await this.request(
			"/torrents/info",
			`hashes=${searchee.infoHash}`,
			X_WWW_FORM_URLENCODED
		);
		const searchResult = JSON.parse(responseText).find(
			(e) => e.hash === searchee.infoHash
		) as TorrentInfo;
		if (searchResult === undefined) {
			throw new Error(
				"Failed to retrieve data dir; torrent not found in client"
			);
		}

		const { progress, save_path, auto_tmm, category } = searchResult;
		return {
			save_path,
			isComplete: progress === 1,
			autoTMM: auto_tmm,
			category,
		};
	}

	async isSubfolderContentLayout(searchee: Searchee): Promise<boolean> {
		const response = await this.request(
			"/torrents/files",
			`hash=${searchee.infoHash}`,
			X_WWW_FORM_URLENCODED
		);

		const files: TorrentFiles[] = JSON.parse(response);
		const [{ name }] = files;
		return files.length === 1 && name !== posix.basename(name);
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		path?: string
	): Promise<InjectionResult> {
		const { duplicateCategories, skipRecheck, dataCategory } =
			getRuntimeConfig();
		try {
			if (await this.isInfoHashInClient(newTorrent.infoHash)) {
				return InjectionResult.ALREADY_EXISTS;
			}

			const filename = `${newTorrent.getFileSystemSafeName()}.cross-seed.torrent`;
			const buffer = new Blob([newTorrent.encode()], {
				type: "application/x-bittorrent",
			});

			const { save_path, isComplete, autoTMM, category } = path
				? {
						save_path: path,
						isComplete: true,
						autoTMM: false,
						category: dataCategory,
				  }
				: await this.getTorrentConfiguration(searchee);

			const newCategoryName =
				duplicateCategories && searchee.infoHash
					? await this.setUpCrossSeedCategory(category)
					: category;

			if (!isComplete) return InjectionResult.TORRENT_NOT_COMPLETE;

			const contentLayout =
				!path &&
				newTorrent.isSingleFileTorrent &&
				(await this.isSubfolderContentLayout(searchee))
					? "Subfolder"
					: "Original";

			const formData = new FormData();
			formData.append("torrents", buffer, filename);
			formData.append("tags", TORRENT_TAG);
			formData.append("category", newCategoryName);

			if (autoTMM) {
				formData.append("autoTMM", "true");
			} else {
				formData.append("autoTMM", "false");
				formData.append("savepath", save_path);
			}
			if (path) {
				formData.append("contentLayout", "Original");
				formData.append("skip_checking", skipRecheck.toString());
				formData.append("paused", (!skipRecheck).toString());
			} else {
				formData.append("contentLayout", contentLayout);
				formData.append("skip_checking", "true");
				formData.append("paused", "false");
			}

			// for some reason the parser parses the last kv pair incorrectly
			// it concats the value and the sentinel
			formData.append("foo", "bar");

			await this.request("/torrents/add", formData);

			if (path && !skipRecheck) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				await this.request(
					"/torrents/recheck",
					`hashes=${newTorrent.infoHash}`,
					X_WWW_FORM_URLENCODED
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
