import bencode from "bencode";
import { promises as fs, Stats } from "fs";
import parseTorrent, { FileListing, Metafile } from "parse-torrent";
import { dirname, resolve } from "path";
import xmlrpc, { Client } from "xmlrpc";
import { InjectionResult } from "../constants";
import { CrossSeedError } from "../errors";
import { Label, logger } from "../logger";
import { getRuntimeConfig } from "../runtimeConfig";
import { Searchee } from "../searchee";
import { wait } from "../utils";
import { TorrentClient } from "./TorrentClient";

interface LibTorrentResumeFileEntry {
	completed: number;
	mtime: number;
	priority: number;
}

interface LibTorrentResume {
	bitfield: number;
	files: LibTorrentResumeFileEntry[];
}

async function createLibTorrentResumeTree(
	meta: Metafile,
	dataDir: string
): Promise<LibTorrentResume> {
	async function getFileResumeData(
		file: FileListing
	): Promise<LibTorrentResumeFileEntry> {
		const filePath = resolve(dataDir, file.path);
		const fileStat = await fs
			.lstat(filePath)
			.catch(() => ({ isFile: () => false } as Stats));
		if (!fileStat.isFile() || fileStat.size !== file.length) {
			logger.debug({
				label: Label.RTORRENT,
				message: `File ${filePath} either doesn't exist or is the wrong size.`,
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
	dataDir: string
): Promise<void> {
	const rawMeta = bencode.decode(parseTorrent.toTorrentFile(meta));
	rawMeta.libtorrent_resume = await createLibTorrentResumeTree(meta, dataDir);
	await fs.writeFile(savePath, bencode.encode(rawMeta));
}

export default class RTorrent implements TorrentClient {
	client: Client;
	constructor() {
		const { rtorrentRpcUrl } = getRuntimeConfig();

		try {
			const { origin, username, password, protocol, pathname } = new URL(
				rtorrentRpcUrl
			);

			const clientCreator =
				protocol === "https:"
					? xmlrpc.createSecureClient
					: xmlrpc.createClient;

			const shouldUseAuth = Boolean(username && password);

			this.client = clientCreator({
				url: origin + pathname,
				basic_auth: shouldUseAuth
					? {
							user: decodeURIComponent(username),
							pass: decodeURIComponent(password),
					  }
					: undefined,
			});
		} catch (e) {
			throw new CrossSeedError("rTorrent url must be percent-encoded");
		}
	}

	private async methodCallP<R>(method: string, args): Promise<R> {
		logger.verbose({
			label: Label.RTORRENT,
			message: `Calling method ${method} with params ${args}`,
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

	async getDataDir(searchee: Searchee): Promise<string> {
		if (searchee.path) return dirname(searchee.path);
		const infoHash = searchee.infoHash.toUpperCase();
		type returnType = [["0" | "1"], [string]];
		const [[isMultiFileStr], [dir]] = await this.methodCallP<returnType>(
			"system.multicall",
			[
				[
					{
						methodName: "d.is_multi_file",
						params: [infoHash],
					},
					{
						methodName: "d.directory",
						params: [infoHash],
					},
				],
			]
		);
		return Number(isMultiFileStr) ? dirname(dir) : dir;
	}

	async validateConfig(): Promise<void> {
		const { rtorrentRpcUrl } = getRuntimeConfig();
		// no validation to do
		if (!rtorrentRpcUrl) return;

		try {
			await this.methodCallP<string[]>("download_list", []);
		} catch (e) {
			throw new CrossSeedError(
				`Failed to reach rTorrent at ${rtorrentRpcUrl}`
			);
		}
	}

	async inject(meta: Metafile, searchee: Searchee): Promise<InjectionResult> {
		const { outputDir } = getRuntimeConfig();

		if (await this.checkForInfoHashInClient(meta.infoHash)) {
			return InjectionResult.ALREADY_EXISTS;
		}

		const dataDir = await this.getDataDir(searchee);
		const torrentFilePath = resolve(
			outputDir,
			`${meta.name}.tmp.${Date.now()}.torrent`
		);
		await saveWithLibTorrentResume(meta, torrentFilePath, dataDir);

		for (let i = 0; i < 5; i++) {
			try {
				await this.methodCallP<void>("load.start", [
					"",
					torrentFilePath,
					`d.directory.set="${dataDir}"`,
					`d.custom1.set="cross-seed"`,
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
