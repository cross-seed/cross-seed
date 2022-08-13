import { CallTracker } from "assert";
import { Metafile } from "parse-torrent";
import { InjectionResult, RenameResult } from "../constants.js";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";

let activeClient: TorrentClient;

export interface TorrentClient {
	inject: (
		newTorrent: Metafile,
		searchee: Searchee,
		nonceOptions: NonceOptions
	) => Promise<InjectionResult>;
	validateConfig: () => Promise<void>;
	rename: (
		torrent: Metafile,
		searchee: Searchee,
		tracker: string,
		nonceOptions: NonceOptions
	) => Promise<RenameResult>;
}

function instantiateDownloadClient() {
	const { rtorrentRpcUrl, qbittorrentUrl } = getRuntimeConfig();
	if (rtorrentRpcUrl) {
		activeClient = new RTorrent();
	} else if (qbittorrentUrl) {
		activeClient = new QBittorrent();
	}
}

export function getClient(): TorrentClient {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}
