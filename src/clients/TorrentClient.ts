import { Metafile } from "parse-torrent";
import { InjectionResult } from "../constants";
import { getRuntimeConfig } from "../runtimeConfig";
import { Searchee } from "../searchee";
import RTorrent from "./RTorrent";

let activeClient: TorrentClient;

export interface TorrentClient {
	inject: (
		newTorrent: Metafile,
		searchee: Searchee
	) => Promise<InjectionResult>;
	validateConfig: () => Promise<void>;
}

function instantiateDownloadClient() {
	const { rtorrentRpcUrl } = getRuntimeConfig();
	if (rtorrentRpcUrl) {
		activeClient = new RTorrent();
	}
}

export function getClient(): TorrentClient {
	if (!activeClient) {
		instantiateDownloadClient();
	}
	return activeClient;
}
