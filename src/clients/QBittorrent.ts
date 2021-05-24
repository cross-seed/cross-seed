import FormData from "form-data";
import fetch, { BodyInit, Response } from "node-fetch";
import parseTorrent, { Metafile } from "parse-torrent";
import querystring from "querystring";
import { InjectionResult } from "../constants";
import { CrossSeedError } from "../errors";
import * as logger from "../logger";
import { getRuntimeConfig } from "../runtimeConfig";
import { Searchee } from "../searchee";
import { TorrentClient } from "./TorrentClient";

interface QTorrentListing {
	save_path: string;
}

const X_WWW_FORM_URLENCODED = {
	"Content-Type": "application/x-www-form-urlencoded",
};

export default class QBittorrent implements TorrentClient {
	url: URL;
	cookie: string;

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		this.url = new URL(`${qbittorrentUrl}/api/v2`);
	}

	async validateConfig(): Promise<void> {
		const { origin, pathname, username, password } = this.url;
		const qs = querystring.encode({ username, password });
		let response: Response;
		try {
			response = await fetch(`${origin}${pathname}/auth/login?${qs}`);
		} catch (e) {
			throw new CrossSeedError(`qBittorrent login failed: ${e.message}`);
		}

		if (response.status !== 200) {
			throw new CrossSeedError(
				`qBittorrent login failed with code ${response.status}`
			);
		}
		const cookieArray = response.headers.raw()["set-cookie"];
		if (cookieArray) {
			this.cookie = cookieArray[0].split(";")[0];
		} else {
			throw new CrossSeedError(
				`qBittorrent login failed: Invalid username or password`
			);
		}
		await this.createTag();
	}

	private async request(
		path: string,
		body: BodyInit,
		headers: Record<string, string> = {}
	): Promise<string> {
		logger.verbose(
			"[qbittorrent]",
			"Making request to",
			path,
			"with body",
			body.toString()
		);
		const { origin, pathname } = this.url;
		const response = await fetch(`${origin}${pathname}${path}`, {
			method: "post",
			headers: { Cookie: this.cookie, ...headers },
			body,
		});
		return response.text();
	}

	async createTag(): Promise<void> {
		await this.request(
			"/torrents/createTags",
			"tags=cross-seed",
			X_WWW_FORM_URLENCODED
		);
	}

	async checkForInfoHashInClient(infoHash: string): Promise<boolean> {
		const responseText = await this.request(
			"/torrents/properties",
			`hash=${infoHash}`,
			X_WWW_FORM_URLENCODED
		);
		if (responseText === "Not Found") {
			return false;
		} else {
			logger.verbose(
				`[qbittorrent] info hash ${infoHash} found in client:`,
				responseText
			);
			return true;
		}
	}

	async getTorrentConfiguration(
		searchee: Searchee
	): Promise<{ save_path: string; category: string; isComplete: boolean }> {
		const responseText = await this.request(
			"/torrents/info",
			`hashes=${searchee.infoHash}`,
			X_WWW_FORM_URLENCODED
		);
		const searchResult = JSON.parse(responseText).find(
			(e) => e.hash === searchee.infoHash
		);
		if (searchResult === undefined) {
			throw new Error(
				"Failed to retrieve data dir; torrent not found in client"
			);
		}
		const { save_path, category, progress } = searchResult;
		return { save_path, category, isComplete: progress === 1 };
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee
	): Promise<InjectionResult> {
		if (await this.checkForInfoHashInClient(newTorrent.infoHash)) {
			return InjectionResult.ALREADY_EXISTS;
		}
		const buf = parseTorrent.toTorrentFile(newTorrent);
		try {
			const {
				save_path,
				category,
				isComplete,
			} = await this.getTorrentConfiguration(searchee);
			if (!isComplete) return InjectionResult.TORRENT_NOT_COMPLETE;
			const formData = new FormData();
			formData.append("torrents", buf, {
				filename: `${newTorrent.name}.cross-seed.torrent`,
				contentType: "application/x-bittorrent",
			});
			formData.append("skip_checking", "true");
			formData.append("savepath", save_path);
			formData.append("tags", "cross-seed");
			formData.append("autoTMM", "false");
			await this.request("/torrents/add", formData);
			return InjectionResult.SUCCESS;
		} catch (e) {
			logger.debug("[qbittorrent]", "injection failed:", e.message);
			return InjectionResult.FAILURE;
		}
	}
}
