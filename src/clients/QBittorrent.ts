import fetch, { Response } from "node-fetch";
import { Metafile } from "parse-torrent";
import querystring from "querystring";
import { InjectionResult } from "../constants";
import { CrossSeedError } from "../errors";
import { getRuntimeConfig } from "../runtimeConfig";
import { Searchee } from "../searchee";
import { TorrentClient } from "./TorrentClient";

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
			this.cookie = cookieArray[0];
		} else {
			throw new CrossSeedError(
				`qBittorrent login failed: Invalid username or password`
			);
		}
	}

	private async request<T>(
		path: string,
		data: Record<string, string>
	): Promise<T> {
		const { origin, pathname } = this.url;
		const qs = querystring.encode(data);
		const response = await fetch(`${origin}${pathname}${path}?${qs}`, {
			method: "post",
			headers: { Cookie: this.cookie },
		});
		return response.json();
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee
	): Promise<InjectionResult> {
		return Promise.resolve(undefined);
	}
}
