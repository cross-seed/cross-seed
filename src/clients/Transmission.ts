import { readdirSync } from "fs";
import {
	DecisionAnyMatch,
	InjectionResult,
	TORRENT_TAG,
} from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee, SearcheeWithInfoHash } from "../searchee.js";
import { loadTorrentDirLight } from "../torrent.js";
import {
	TorrentMetadataInClient,
	getMaxRemainingBytes,
	getResumeStopTime,
	resumeErrSleepTime,
	resumeSleepTime,
	shouldRecheck,
	TorrentClient,
	validateSavePaths,
} from "./TorrentClient.js";
import {
	extractCredentialsFromUrl,
	humanReadableSize,
	sanitizeInfoHash,
	wait,
} from "../utils.js";

const XTransmissionSessionId = "X-Transmission-Session-Id";
type Method =
	| "session-get"
	| "torrent-add"
	| "torrent-get"
	| "torrent-stop"
	| "torrent-verify"
	| "torrent-start";

interface Response<T> {
	result: "success" | string;
	arguments: T;
}

interface TorrentGetResponseArgs {
	torrents: {
		downloadDir: string;
		hashString: string;
		leftUntilDone: number;
		name: string;
		percentDone: number;
		status: number;
		labels: string[];
	}[];
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
	readonly type = Label.TRANSMISSION;

	private async request<T>(
		method: Method,
		args: unknown = {},
		retries = 1,
	): Promise<T> {
		const { transmissionRpcUrl } = getRuntimeConfig();

		const { username, password, href } = extractCredentialsFromUrl(
			transmissionRpcUrl!,
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
			if (e instanceof SyntaxError) {
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
		const { torrentDir } = getRuntimeConfig();
		try {
			await this.request("session-get");
		} catch (e) {
			const { transmissionRpcUrl } = getRuntimeConfig();
			throw new CrossSeedError(
				`Failed to reach Transmission at ${transmissionRpcUrl}`,
			);
		}

		if (!torrentDir) return;
		if (!readdirSync(torrentDir).some((f) => f.endsWith(".torrent"))) {
			throw new CrossSeedError(
				"Invalid torrentDir, if no torrents are in client set to null for now: https://www.cross-seed.org/docs/basics/options#torrentdir",
			);
		}
		const searcheesRes = loadTorrentDirLight(torrentDir);
		const infoHashPathMap = await this.getAllDownloadDirs({
			onlyCompleted: false,
		});
		await validateSavePaths(infoHashPathMap, await searcheesRes);
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
		options: { onlyCompleted: boolean },
	): Promise<
		Result<string, "NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "UNKNOWN_ERROR">
	> {
		const result = await this.checkOriginalTorrent(
			meta,
			options.onlyCompleted,
		);
		return result
			.mapOk((r) => r.downloadDir)
			.mapErr((err) => (err === "FAILURE" ? "UNKNOWN_ERROR" : err));
	}

	async getAllDownloadDirs(options: {
		onlyCompleted: boolean;
	}): Promise<Map<string, string>> {
		let torrents = (
			await this.request<TorrentGetResponseArgs>("torrent-get", {
				fields: ["hashString", "downloadDir", "percentDone"],
			})
		).torrents;
		if (options.onlyCompleted) {
			torrents = torrents.filter((torrent) => torrent.percentDone === 1);
		}
		return torrents.reduce((acc, { hashString, downloadDir }) => {
			acc.set(hashString, downloadDir);
			return acc;
		}, new Map());
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

	async getAllTorrents(): Promise<TorrentMetadataInClient[]> {
		const res = await this.request<TorrentGetResponseArgs>("torrent-get", {
			fields: ["hashString", "labels"],
		});
		return res.torrents.map((torrent) => ({
			infoHash: torrent.hashString,
			category: "",
			tags: torrent.labels,
		}));
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		// Pause first as it may resume after recheck automatically
		await this.request<void>("torrent-stop", {
			ids: [infoHash],
		});
		await this.request<void>("torrent-verify", {
			ids: [infoHash],
		});
	}

	async resumeInjection(
		infoHash: string,
		decision: DecisionAnyMatch,
		options: { checkOnce: boolean },
	): Promise<void> {
		let sleepTime = resumeSleepTime;
		const maxRemainingBytes = getMaxRemainingBytes(decision);
		const stopTime = getResumeStopTime();
		let stop = false;
		while (Date.now() < stopTime) {
			if (options.checkOnce) {
				if (stop) return;
				stop = true;
			}
			await wait(sleepTime);
			const queryResponse = await this.request<TorrentGetResponseArgs>(
				"torrent-get",
				{
					fields: ["leftUntilDone", "name", "status"],
					ids: [infoHash],
				},
			);
			if (queryResponse.torrents.length === 0) {
				sleepTime = resumeErrSleepTime; // Dropping connections or restart
				continue;
			}
			const [{ leftUntilDone, name, status }] = queryResponse.torrents;
			if ([1, 2].includes(status)) {
				continue;
			}
			const torrentLog = `${name} [${sanitizeInfoHash(infoHash)}]`;
			if (status !== 0) {
				logger.warn({
					label: Label.TRANSMISSION,
					message: `Will not resume ${torrentLog}: status is ${status}`,
				});
				return;
			}
			if (leftUntilDone > maxRemainingBytes) {
				logger.warn({
					label: Label.TRANSMISSION,
					message: `Will not resume ${torrentLog}: ${humanReadableSize(leftUntilDone, { binary: true })} remaining > ${humanReadableSize(maxRemainingBytes, { binary: true })}`,
				});
				return;
			}
			logger.info({
				label: Label.TRANSMISSION,
				message: `Resuming ${torrentLog}: ${humanReadableSize(leftUntilDone, { binary: true })} remaining`,
			});
			await this.request<void>("torrent-start", {
				ids: [infoHash],
			});
			return;
		}
		logger.warn({
			label: Label.TRANSMISSION,
			message: `Will not resume torrent ${infoHash}: timeout`,
		});
	}

	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		path?: string,
	): Promise<InjectionResult> {
		let downloadDir: string;
		if (path) {
			downloadDir = path;
		} else {
			const result = await this.getDownloadDir(
				searchee as SearcheeWithInfoHash,
				{ onlyCompleted: true },
			);
			if (result.isErr()) {
				return InjectionResult.FAILURE;
			} else {
				downloadDir = result.unwrap();
			}
		}

		let addResponse: TorrentAddResponse;

		try {
			addResponse = await this.request<TorrentAddResponse>(
				"torrent-add",
				{
					"download-dir": downloadDir,
					metainfo: newTorrent.encode().toString("base64"),
					paused: shouldRecheck(searchee, decision),
					labels: [TORRENT_TAG],
				},
			);
			this.resumeInjection(newTorrent.infoHash, decision, {
				checkOnce: false,
			});
		} catch (e) {
			return InjectionResult.FAILURE;
		}

		if (doesAlreadyExist(addResponse)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		return InjectionResult.SUCCESS;
	}
}
