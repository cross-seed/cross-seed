import { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants";
import { log } from "../logger";
import { getRuntimeConfig } from "../runtimeConfig";
import { Searchee } from "../searchee";
import { TorrentClient } from "./TorrentClient";
import fetch from "node-fetch";

export default class QBittorrent implements TorrentClient {
	url: URL;
	cookie: string;

	constructor() {
		const { qbittorrentUrl } = getRuntimeConfig();
		this.url = new URL(`${qbittorrentUrl}/api`);
	}

	async validateConfig(): Promise<void> {
		const { origin, pathname, username, password } = this.url;
		const response = await fetch(`${origin}${pathname}/login`);
		console.log(response.headers.get("Set-Cookie"));
	}

	private async request<T>(path: string, data: unknown): Promise<T> {
		const { origin, pathname, username, password } = this.url;

		const response = await fetch(origin + pathname + path, {
			method: "post",
			body: JSON.stringify(data),
			headers: {
				"Content-Type": "application/json",
				Cookie: this.cookie,
			},
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
