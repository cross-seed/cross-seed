import {
	DecisionAllMatch,
	InjectionResult,
	TORRENT_TAG,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import { shouldRecheck, extractCredentialsFromUrl } from "../utils.js";
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
	args: TorrentAddResponse,
): args is TorrentDuplicateResponse {
	return "torrent-duplicate" in args;
}

export default class Transmission implements TorrentClient {
	xTransmissionSessionId: string;

	private async request<T>(
		method: Method,
		args: unknown = {},
		retries = 1,
	): Promise<T> {
		const { transmissionRpcUrl } = getRuntimeConfig();

		const { username, password, href } = extractCredentialsFromUrl(
			transmissionRpcUrl,
		).unwrapOrThrow(
			new CrossSeedError("Transmission rpc url must be percent-encoded"),
		);

		const headers = new Headers();
		headers.set("Content-Type", "application/json");
		if (this.xTransmissionSessionId) {
			headers.set(XTransmissionSessionId, this.xTransmissionSessionId);
		}
		if (username && password) {
			const credentials = Buffer.from(`${username}:${password}`).toString(
				"base64",
			);
			headers.set("Authorization", `Basic ${credentials}`);
		}

		const response = await fetch(href, {
			method: "POST",
			body: JSON.stringify({ method, arguments: args }),
			headers,
		});
		if (response.status === 409) {
			this.xTransmissionSessionId = response.headers.get(
				XTransmissionSessionId,
			)!;
			return this.request(method, args, retries - 1);
		}
		try {
			const responseBody = (await response.json()) as Response<T>;
			if (
				responseBody.result === "success" ||
				responseBody.result === "duplicate torrent" // slight hack but best solution for now
			) {
				return responseBody.arguments;
			} else {
				throw new Error(
					`Transmission responded with error: "${responseBody.result}"`,
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
			const { transmissionRpcUrl } = getRuntimeConfig();
			throw new CrossSeedError(
				`Failed to reach Transmission at ${transmissionRpcUrl}`,
			);
		}
	}

	async checkOriginalTorrent(
		data: SearcheeWithInfoHash | Metafile,
		onlyCompleted: boolean,
	): Promise<
		Result<
			{ downloadDir: string },
			InjectionResult.FAILURE | InjectionResult.TORRENT_NOT_COMPLETE
		>
	> {
		let queryResponse: TorrentGetResponseArgs;
		try {
			queryResponse = await this.request<TorrentGetResponseArgs>(
				"torrent-get",
				{
					fields: ["downloadDir", "percentDone"],
					ids: [data.infoHash],
				},
			);
		} catch (e) {
			return resultOfErr(InjectionResult.FAILURE);
		}
		if (queryResponse.torrents.length === 0) {
			return resultOfErr(InjectionResult.FAILURE);
		}

		const [{ downloadDir, percentDone }] = queryResponse.torrents;

		if (onlyCompleted && percentDone < 1) {
			return resultOfErr(InjectionResult.TORRENT_NOT_COMPLETE);
		}

		return resultOf({ downloadDir });
	}

	async getDownloadDir(
		meta: SearcheeWithInfoHash | Metafile,
		onlyCompleted: boolean,
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		const result = await this.checkOriginalTorrent(meta, onlyCompleted);
		return result
			.mapOk((r) => r.downloadDir)
			.mapErr((err) => (err === "FAILURE" ? "UNKNOWN_ERROR" : err));
	}

	async getAllDownloadDirs(
		onlyCompleted: boolean,
	): Promise<Map<string, string>> {
		const queryResponse = await this.request<TorrentGetResponseArgs>(
			"torrent-get",
			{
				fields: ["downloadDir", "percentDone"],
			},
		);
		const downloadDirs = new Map<string, string>();
		for (const { downloadDir, percentDone } of queryResponse.torrents) {
			if (onlyCompleted && percentDone < 1) continue;
			downloadDirs.set(downloadDir, downloadDir);
		}
		return downloadDirs;
	}

	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		const queryResponse = await this.request<TorrentGetResponseArgs>(
			"torrent-get",
			{
				fields: ["percentDone"],
				ids: [infoHash],
			},
		);
		if (queryResponse.torrents.length === 0) {
			return resultOfErr("NOT_FOUND");
		}
		const [{ percentDone }] = queryResponse.torrents;
		return resultOf(percentDone === 1);
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAllMatch,
		path?: string,
	): Promise<InjectionResult> {
		let downloadDir: string;
		if (path) {
			downloadDir = path;
		} else {
			const result = await this.getDownloadDir(
				searchee as SearcheeWithInfoHash,
				true,
			);
			if (result.isErr()) {
				return InjectionResult.FAILURE;
			} else {
				downloadDir = result.unwrapOrThrow();
			}
		}

		let addResponse: TorrentAddResponse;

		try {
			addResponse = await this.request<TorrentAddResponse>(
				"torrent-add",
				{
					"download-dir": downloadDir,
					metainfo: newTorrent.encode().toString("base64"),
					paused: shouldRecheck(decision),
					labels: [TORRENT_TAG],
				},
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
