import { CallTracker } from "assert";
import { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants.js";
import { getRuntimeConfig, NonceOptions } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";

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
	const { rtorrentRpcUrl, qbittorrentUrl, transmissionRpcUrl } =
		getRuntimeConfig();
	if (rtorrentRpcUrl) {
		activeClient = new RTorrent();
	} else if (qbittorrentUrl) {
		activeClient = new QBittorrent();
	} else if (transmissionRpcUrl) {
		activeClient = new Transmission();
	}
}

export function getClient(): TorrentClient {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}
