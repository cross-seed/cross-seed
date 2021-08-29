import { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig";
import { Searchee } from "../searchee";
import QBittorrent from "./QBittorrent";
import RTorrent from "./RTorrent";

let activeClient: TorrentClient;

export interface TorrentClient {
	inject: (
		newTorrent: Metafile,
		searchee: Searchee,
		nonceOptions: NonceOptions
	) => Promise<InjectionResult>;
	validateConfig: () => Promise<void>;
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
