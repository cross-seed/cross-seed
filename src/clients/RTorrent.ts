import type { Stats } from "fs";
import { stat, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import { inspect } from "util";
import xmlrpc, { Client } from "xmlrpc";
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
import { File, Searchee, SearcheeWithInfoHash } from "../searchee.js";
import {
	extractCredentialsFromUrl,
	isTruthy,
	shouldRecheck,
	wait,
} from "../utils.js";
import { TorrentClient } from "./TorrentClient.js";

const COULD_NOT_FIND_INFO_HASH = "Could not find info-hash.";

interface LibTorrentResumeFileEntry {
	completed: number;
	mtime: number;
	priority: number;
}

interface LibTorrentResume {
	bitfield: number;
	files: LibTorrentResumeFileEntry[];
}

interface DownloadLocation {
	/**
	 * directoryBase is the root directory of a multi-file torrent,
	 * or the parent directory of a single-file torrent.
	 */
	directoryBase: string;
	basePath: string;
	downloadDir: string;
}

type Fault = { faultCode: number; faultString: string };

async function createLibTorrentResumeTree(
	meta: Metafile,
	basePath: string,
): Promise<LibTorrentResume> {
	async function getFileResumeData(
		file: File,
	): Promise<LibTorrentResumeFileEntry | null> {
		const filePathWithoutFirstSegment = file.path
			.split(sep)
			.slice(1)
			.join(sep);
		const resolvedFilePath = resolve(basePath, filePathWithoutFirstSegment);
		const fileStat = await stat(resolvedFilePath).catch(
			() => ({ isFile: () => false }) as Stats,
		);
		if (!fileStat.isFile() || fileStat.size !== file.length) {
			return null;
		}

		return {
			completed: Math.ceil(file.length / meta.pieceLength),
			mtime: Math.trunc(fileStat.mtimeMs / 1000),
			priority: 1,
		};
	}

	const fileResumes = await Promise.all(meta.files.map(getFileResumeData));
	return {
		bitfield: Math.ceil(meta.length / meta.pieceLength),
		files: fileResumes.filter(isTruthy),
	};
}

async function saveWithLibTorrentResume(
	meta: Metafile,
	savePath: string,
	basePath: string,
): Promise<void> {
	const rawWithLibtorrentResume = {
		...meta.raw,
		libtorrent_resume: await createLibTorrentResumeTree(meta, basePath),
	};
	await writeFile(savePath, new Metafile(rawWithLibtorrentResume).encode());
}

export default class RTorrent implements TorrentClient {
	client: Client;

	constructor() {
		const { rtorrentRpcUrl } = getRuntimeConfig();

		const { href, username, password } = extractCredentialsFromUrl(
			rtorrentRpcUrl,
		).unwrapOrThrow(
			new CrossSeedError("rTorrent url must be percent-encoded"),
		);

		const clientCreator =
			new URL(href).protocol === "https:"
				? xmlrpc.createSecureClient
				: xmlrpc.createClient;

		const shouldUseAuth = Boolean(username && password);

		this.client = clientCreator({
			url: href,
			basic_auth: shouldUseAuth
				? { user: username, pass: password }
				: undefined,
		});
	}

	private async methodCallP<R>(method: string, args): Promise<R> {
		logger.verbose({
			label: Label.RTORRENT,
			message: `Calling method ${method} with params ${inspect(args, {
				depth: null,
				compact: true,
			})}`,
		});
		return new Promise((resolve, reject) => {
			this.client.methodCall(method, args, (err, data) => {
				if (err) return reject(err);
				return resolve(data);
			});
		});
	}

	async checkForInfoHashInClient(infoHash: string): Promise<boolean> {
		const downloadList = await this.methodCallP<string[]>(
			"download_list",
			[],
		);
		return downloadList.includes(infoHash.toUpperCase());
	}

	private async checkOriginalTorrent(
		data: SearcheeWithInfoHash | Metafile,
		onlyCompleted: boolean,
	): Promise<
		Result<
			{ directoryBase: string; isMultiFile: boolean },
			"FAILURE" | "TORRENT_NOT_COMPLETE" | "NOT_FOUND"
		>
	> {
		const infoHash = data.infoHash.toUpperCase();
		type ReturnType =
			| [[string], ["0" | "1"], ["0" | "1"]]
			| [Fault, Fault, Fault];

		let response: ReturnType;
		try {
			response = await this.methodCallP<ReturnType>("system.multicall", [
				[
					{
						methodName: "d.directory",
						params: [infoHash],
					},
					{
						methodName: "d.complete",
						params: [infoHash],
					},
					{
						methodName: "d.is_multi_file",
						params: [infoHash],
					},
				],
			]);
		} catch (e) {
			logger.debug(e);
			return resultOfErr("FAILURE");
		}

		function isFault(
			response: ReturnType,
		): response is [Fault, Fault, Fault] {
			return "faultString" in response[0];
		}

		try {
			if (isFault(response)) {
				if (response[0].faultString === COULD_NOT_FIND_INFO_HASH) {
					return resultOfErr("NOT_FOUND");
				} else {
					throw new Error(
						"Unknown rTorrent fault while checking original torrent",
					);
				}
			}
			const [[directoryBase], [isCompleteStr], [isMultiFileStr]] =
				response;
			const isComplete = Boolean(Number(isCompleteStr));
			if (onlyCompleted && !isComplete) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
			return resultOf({
				directoryBase,
				isMultiFile: Boolean(Number(isMultiFileStr)),
			});
		} catch (e) {
			logger.error(e);
			logger.debug("Failure caused by server response below:");
			logger.debug(inspect(response));
			return resultOfErr("FAILURE");
		}
	}

	private async getDownloadLocation(
		meta: Metafile,
		searchee: Searchee,
		path?: string,
	): Promise<
		Result<
			DownloadLocation,
			"NOT_FOUND" | "TORRENT_NOT_COMPLETE" | "FAILURE"
		>
	> {
		if (path) {
			// resolve to absolute because we send the path to rTorrent
			const basePath = resolve(path, meta.name);
			const directoryBase = meta.isSingleFileTorrent ? path : basePath;
			return resultOf({ downloadDir: path, basePath, directoryBase });
		} else {
			const result = await this.checkOriginalTorrent(
				searchee as SearcheeWithInfoHash,
				true,
			);
			return result.mapOk(({ directoryBase }) => ({
				directoryBase,
				downloadDir: meta.isSingleFileTorrent
					? directoryBase
					: dirname(directoryBase),
				basePath: meta.isSingleFileTorrent
					? join(directoryBase, searchee.name)
					: directoryBase,
			}));
		}
	}

	async validateConfig(): Promise<void> {
		const { rtorrentRpcUrl } = getRuntimeConfig();
		// no validation to do
		if (!rtorrentRpcUrl) return;

		try {
			await this.methodCallP<string[]>("download_list", []);
		} catch (e) {
			logger.debug(e);
			throw new CrossSeedError(
				`Failed to reach rTorrent at ${rtorrentRpcUrl}`,
			);
		}
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
			.mapOk(({ directoryBase, isMultiFile }) => {
				return isMultiFile ? dirname(directoryBase) : directoryBase;
			})
			.mapErr((error) => (error === "FAILURE" ? "UNKNOWN_ERROR" : error));
	}

	async isTorrentComplete(
		infoHash: string,
	): Promise<Result<boolean, "NOT_FOUND">> {
		try {
			const response = await this.methodCallP<string[]>("d.complete", [
				infoHash,
			]);
			if (response.length === 0) {
				return resultOfErr("NOT_FOUND");
			}
			return resultOf(response[0] === "1");
		} catch (e) {
			return resultOfErr("NOT_FOUND");
		}
	}

	async recheckTorrent(infoHash: string): Promise<void> {
		// Pause first as it may resume after recheck automatically
		await this.methodCallP<void>("d.pause", [infoHash]);
		await this.methodCallP<void>("d.check_hash", [infoHash]);
	}

	async inject(
		meta: Metafile,
		searchee: Searchee,
		decision: DecisionAnyMatch,
		path?: string,
	): Promise<InjectionResult> {
		const { outputDir } = getRuntimeConfig();

		if (await this.checkForInfoHashInClient(meta.infoHash)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		const result = await this.getDownloadLocation(meta, searchee, path);
		if (result.isErr()) {
			switch (result.unwrapErr()) {
				case "NOT_FOUND":
					return InjectionResult.FAILURE;
				case "TORRENT_NOT_COMPLETE":
					return InjectionResult.TORRENT_NOT_COMPLETE;
				case "FAILURE":
					return InjectionResult.FAILURE;
			}
		}
		const { directoryBase, basePath } = result.unwrap();

		const torrentFilePath = resolve(
			outputDir,
			`${meta.name}.tmp.${Date.now()}.torrent`,
		);

		await saveWithLibTorrentResume(meta, torrentFilePath, basePath);

		const recheck = shouldRecheck(searchee, decision);
		const loadType = recheck ? "load.normal" : "load.start";

		const retries = 5;
		for (let i = 0; i < retries; i++) {
			try {
				await this.methodCallP<void>(
					loadType,
					[
						"",
						torrentFilePath,
						`d.directory_base.set="${directoryBase}"`,
						`d.custom1.set="${TORRENT_TAG}"`,
						`d.custom.set=addtime,${Math.round(Date.now() / 1000)}`,
						recheck
							? `d.check_hash=${meta.infoHash.toUpperCase()}`
							: null,
					].filter((e) => e !== null),
				);
				break;
			} catch (e) {
				logger.verbose({
					label: Label.RTORRENT,
					message: `Failed to inject torrent ${meta.name} on attempt ${i + 1}/${retries}`,
				});
				logger.debug(e);
				await wait(1000 * Math.pow(2, i));
			}
		}

		for (let i = 0; i < 5; i++) {
			if (await this.checkForInfoHashInClient(meta.infoHash)) {
				setTimeout(() => unlink(torrentFilePath), 1000);
				return InjectionResult.SUCCESS;
			}
			await wait(100 * Math.pow(2, i));
		}
		setTimeout(() => unlink(torrentFilePath), 1000);
		return InjectionResult.FAILURE;
	}
}
