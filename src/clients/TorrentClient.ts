import { Metafile } from "../parseTorrent.js";
import { InjectionResult } from "../constants.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import QBittorrent from "./QBittorrent.js";
import RTorrent from "./RTorrent.js";
import Transmission from "./Transmission.js";
import Deluge from "./Deluge.js";

let activeClient: TorrentClient;

export interface TorrentClient {
	inject: (
		newTorrent: Metafile,
		searchee: Searchee,
		path?: string
	) => Promise<InjectionResult>;
	validateConfig: () => Promise<void>;
}

function instantiateDownloadClient() {
	const { rtorrentRpcUrl, qbittorrentUrl, transmissionRpcUrl, delugeWebUrl } =
		getRuntimeConfig();
	if (rtorrentRpcUrl) {
		activeClient = new RTorrent();
	} else if (qbittorrentUrl) {
		activeClient = new QBittorrent();
	} else if (transmissionRpcUrl) {
		activeClient = new Transmission();
	} else if (delugeWebUrl) {
		activeClient = new Deluge();
	}
}

export function getClient(): TorrentClient {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}
