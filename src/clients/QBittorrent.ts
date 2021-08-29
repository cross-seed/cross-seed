import FormData from "form-data";
import fetch, { BodyInit, Response } from "node-fetch";
import parseTorrent, { Metafile } from "parse-torrent";
import querystring from "querystring";
import { InjectionResult } from "../constants";
import { CrossSeedError } from "../errors";
import { Label, logger } from "../logger";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig";
import { Searchee } from "../searchee";
import { TorrentClient } from "./TorrentClient";

const X_WWW_FORM_URLENCODED = {
	"Content-Type": "application/x-www-form-urlencoded",
};

export default class QBittorrent implements TorrentClient {
	url: URL;
	cookie: string;

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		try {
			this.url = new URL(`${qbittorrentUrl}/api/v2`);
		} catch (e) {
			throw new CrossSeedError("qBittorrent url must be percent-encoded");
		}
	}

	async login(): Promise<void> {
		const { origin, pathname, username, password } = this.url;

		let qs;
		try {
			qs = querystring.encode({
				username: decodeURIComponent(username),
				password: decodeURIComponent(password),
			});
		} catch (e) {
			throw new CrossSeedError("qBittorrent url must be percent-encoded");
		}

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
			message: `Making request to ${path} with body ${body.toString()}`,
		});
		const { origin, pathname } = this.url;
		const response = await fetch(`${origin}${pathname}${path}`, {
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

	async createTag(): Promise<void> {
		await this.request(
			"/torrents/createTags",
			"tags=cross-seed",
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
		searchee: Searchee,
		nonceOptions: NonceOptions
	): Promise<InjectionResult> {
		if (await this.isInfoHashInClient(newTorrent.infoHash)) {
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
			logger.debug({
				label: Label.QBITTORRENT,
				message: `injection failed: ${e.message}`,
			});
			return InjectionResult.FAILURE;
		}
	}
}
