import { promises as fs, Stats } from "fs";
import { dirname, join, resolve, sep } from "path";
import { inspect } from "util";
import xmlrpc, { Client } from "xmlrpc";
import { InjectionResult, TORRENT_TAG } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { File, Searchee, SearcheeWithInfoHash } from "../searchee.js";
import { extractCredentialsFromUrl, wait } from "../utils.js";
import { TorrentClient } from "./TorrentClient.js";

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

async function createLibTorrentResumeTree(
	meta: Metafile,
	basePath: string
): Promise<LibTorrentResume> {
	async function getFileResumeData(
		file: File
	): Promise<LibTorrentResumeFileEntry> {
		const filePathWithoutFirstSegment = file.path
			.split(sep)
			.slice(1)
			.join(sep);

		const resolvedFilePath = resolve(basePath, filePathWithoutFirstSegment);
		const fileStat = await fs
			.stat(resolvedFilePath)
			.catch(() => ({ isFile: () => false } as Stats));
		if (!fileStat.isFile() || fileStat.size !== file.length) {
			logger.debug({
				label: Label.RTORRENT,
				message: `File ${resolvedFilePath} either doesn't exist or is the wrong size.`,
			});
			return {
				completed: 0,
				mtime: 0,
				priority: 0,
			};
		}

		return {
			completed: Math.ceil(file.length / meta.pieceLength),
			mtime: Math.trunc(fileStat.mtimeMs / 1000),
			priority: 0,
		};
	}

	return {
		bitfield: Math.ceil(meta.length / meta.pieceLength),
		files: await Promise.all<LibTorrentResumeFileEntry>(
			meta.files.map(getFileResumeData)
		),
	};
}

async function saveWithLibTorrentResume(
	meta: Metafile,
	savePath: string,
	basePath: string
): Promise<void> {
	const rawWithLibtorrentResume = {
		...meta.raw,
		libtorrent_resume: await createLibTorrentResumeTree(meta, basePath),
	};
	await fs.writeFile(
		savePath,
		new Metafile(rawWithLibtorrentResume).encode()
	);
}

export default class RTorrent implements TorrentClient {
	client: Client;
	constructor() {
		const { rtorrentRpcUrl } = getRuntimeConfig();

		const { href, username, password } = extractCredentialsFromUrl(
			rtorrentRpcUrl
		).unwrapOrThrow(
			new CrossSeedError("rTorrent url must be percent-encoded")
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
			[]
		);
		return downloadList.includes(infoHash.toUpperCase());
	}

	private async checkOriginalTorrent(
		searchee: SearcheeWithInfoHash
	): Promise<
		Result<
			{ directoryBase: string },
			InjectionResult.FAILURE | InjectionResult.TORRENT_NOT_COMPLETE
		>
	> {
		const infoHash = searchee.infoHash.toUpperCase();
		type ReturnType = [[string], ["0" | "1"]];
		let result;
		try {
			result = await this.methodCallP<ReturnType>("system.multicall", [
				[
					{
						methodName: "d.directory",
						params: [infoHash],
					},
					{
						methodName: "d.complete",
						params: [infoHash],
					},
				],
			]);
		} catch (e) {
			logger.debug(e);
			return resultOfErr(InjectionResult.FAILURE);
		}

		// temp diag for #154
		try {
			const [[directoryBase], [isCompleteStr]] = result;
			const isComplete = Boolean(Number(isCompleteStr));
			if (!isComplete) {
				return resultOfErr(InjectionResult.TORRENT_NOT_COMPLETE);
			}
			return resultOf({ directoryBase });
		} catch (e) {
			logger.error(e);
			logger.debug("Failure caused by server response below:");
			logger.debug(inspect(result));
			return resultOfErr(InjectionResult.FAILURE);
		}
	}

	private async getDownloadLocation(
		meta: Metafile,
		searchee: Searchee,
		path?: string
	): Promise<
		Result<
			DownloadLocation,
			InjectionResult.FAILURE | InjectionResult.TORRENT_NOT_COMPLETE
		>
	> {
		if (path) {
			const basePath = join(path, searchee.name);
			const directoryBase = meta.isSingleFileTorrent ? path : basePath;
			return resultOf({ downloadDir: path, basePath, directoryBase });
		} else {
			const result = await this.checkOriginalTorrent(
				searchee as SearcheeWithInfoHash
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
				`Failed to reach rTorrent at ${rtorrentRpcUrl}`
			);
		}
	}

	async inject(
		meta: Metafile,
		searchee: Searchee,
		path?: string
	): Promise<InjectionResult> {
		const { outputDir } = getRuntimeConfig();

		if (await this.checkForInfoHashInClient(meta.infoHash)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		const result = await this.getDownloadLocation(meta, searchee, path);
		if (result.isErr()) return result.unwrapErrOrThrow();
		const { directoryBase, basePath } = result.unwrapOrThrow();

		const torrentFilePath = resolve(
			outputDir,
			`${meta.name}.tmp.${Date.now()}.torrent`
		);

		await saveWithLibTorrentResume(meta, torrentFilePath, basePath);

		for (let i = 0; i < 5; i++) {
			try {
				await this.methodCallP<void>("load.start", [
					"",
					torrentFilePath,
					`d.directory_base.set="${directoryBase}"`,
					`d.custom1.set="${TORRENT_TAG}"`,
					`d.custom.set=addtime,${Math.round(Date.now() / 1000)}`,
				]);
				break;
			} catch (e) {
				await wait(1000 * Math.pow(2, i));
			}
		}

		for (let i = 0; i < 5; i++) {
			if (await this.checkForInfoHashInClient(meta.infoHash)) {
				setTimeout(() => fs.unlink(torrentFilePath), 1000);
				return InjectionResult.SUCCESS;
			}
			await wait(100 * Math.pow(2, i));
		}
		setTimeout(() => fs.unlink(torrentFilePath), 1000);
		return InjectionResult.FAILURE;
	}
}
