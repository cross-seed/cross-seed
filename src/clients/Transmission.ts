import fetch from "node-fetch";
import { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";

const XTransmissionSessionId = "X-Transmission-Session-Id";
type Method = "session-get" | "torrent-add";

export default class Transmission implements TorrentClient {
	xTransmissionSessionId: string;
	inject(
		newTorrent: Metafile,
		searchee: Searchee,
		nonceOptions: NonceOptions
	): Promise<InjectionResult> {
		return Promise.resolve(undefined);
	}

	private async request(
		method: Method,
		args: unknown = {},
		retries = 1
	): Promise<unknown> {
		const { transmissionUrl } = getRuntimeConfig();

		const { username, password, origin, pathname } = new URL(
			transmissionUrl
		);

		const headers = [["Content-Type", "application/json"]];
		if (this.xTransmissionSessionId) {
			headers.push([XTransmissionSessionId, this.xTransmissionSessionId]);
		}
		if (username && password) {
			const credentials = Buffer.from(`${username}:${password}`).toString(
				"base64"
			);
			headers.push(["Authorization", `Basic ${credentials}`]);
		}
		console.log(headers);
		const response = await fetch(origin + pathname, {
			method: "POST",
			body: JSON.stringify({ method, arguments: args }),
			headers: Object.fromEntries(headers),
		});
		if (response.status === 409) {
			console.log("setting csrf token");
			this.xTransmissionSessionId = response.headers.get(
				XTransmissionSessionId
			);
			return this.request(method, args, retries - 1);
		} else {
			response.clone().text().then(console.log);
			return response.json();
		}
	}

	async validateConfig(): Promise<void> {
		const json = await this.request("session-get");
		if (json.result === "success") {
			console.log(json);
			return;
		}
		const { transmissionUrl } = getRuntimeConfig();
		throw new CrossSeedError(
			`Failed to reach Transmission at ${transmissionUrl}`
		);
	}
}
