import fetch from "node-fetch";
import parseTorrent, { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";

const XTransmissionSessionId = "X-Transmission-Session-Id";
type Method = "session-get" | "torrent-add" | "torrent-get";

interface Response<T> {
	result: "success" | string;
	arguments: T;
}

interface TorrentGetResponseArgs {
	torrents: { downloadDir: string; percentDone: number }[];
}

interface TorrentMetadata {
	hashString: string;
	id: number;
	name: string;
}

type TorrentDuplicateResponse = { "torrent-duplicate": TorrentMetadata };
type TorrentAddedResponse = { "torrent-added": TorrentMetadata };
type TorrentAddResponse = TorrentAddedResponse | TorrentDuplicateResponse;

function doesAlreadyExist(
	args: TorrentAddResponse
): args is TorrentDuplicateResponse {
	return "torrent-duplicate" in args;
}

export default class Transmission implements TorrentClient {
	xTransmissionSessionId: string;

	private async request<T>(
		method: Method,
		args: unknown = {},
		retries = 1
	): Promise<T> {
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

		const response = await fetch(origin + pathname, {
			method: "POST",
			body: JSON.stringify({ method, arguments: args }),
			headers: Object.fromEntries(headers),
		});
		if (response.status === 409) {
			this.xTransmissionSessionId = response.headers.get(
				XTransmissionSessionId
			);
			return this.request(method, args, retries - 1);
		}
		try {
			const responseBody = (await response.json()) as Response<T>;
			if (responseBody.result === "success") {
				return responseBody.arguments;
			} else {
				throw new Error(
					`Transmission responded with error: "${responseBody.result}"`
				);
			}
		} catch (e) {
			if (e instanceof TypeError) {
				logger.error({
					label: Label.TRANSMISSION,
					message: `Transmission returned non-JSON response`,
				});
				logger.debug({
					label: Label.TRANSMISSION,
					message: response,
				});
			} else {
				logger.error({
					label: Label.TRANSMISSION,
					message: `Transmission responded with an error`,
				});
				logger.debug(e);
			}
			throw e;
		}
	}

	async validateConfig(): Promise<void> {
		try {
			await this.request("session-get");
		} catch (e) {
			const { transmissionUrl } = getRuntimeConfig();
			throw new CrossSeedError(
				`Failed to reach Transmission at ${transmissionUrl}`
			);
		}
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		nonceOptions: NonceOptions
	): Promise<InjectionResult> {
		if (!searchee.infoHash) {
			throw new CrossSeedError(
				"inject not supported for data-based searchees"
			);
		}
		let queryResponse: TorrentGetResponseArgs;
		try {
			queryResponse = await this.request<TorrentGetResponseArgs>(
				"torrent-get",
				{
					fields: ["downloadDir", "percentDone"],
					ids: [searchee.infoHash],
				}
			);
		} catch (e) {
			return InjectionResult.FAILURE;
		}

		if (queryResponse.torrents.length === 0) return InjectionResult.FAILURE;
		const [{ downloadDir, percentDone }] = queryResponse.torrents;
		if (percentDone < 1) return InjectionResult.TORRENT_NOT_COMPLETE;

		let addResponse: TorrentAddResponse;
		try {
			addResponse = await this.request<TorrentAddResponse>(
				"torrent-add",
				{
					"download-dir": downloadDir,
					metainfo: parseTorrent
						.toTorrentFile(newTorrent)
						.toString("base64"),
					paused: true,
					labels: ["cross-seed"],
				}
			);
		} catch (e) {
			return InjectionResult.FAILURE;
		}

		if (doesAlreadyExist(addResponse)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		return InjectionResult.SUCCESS;
	}
}
