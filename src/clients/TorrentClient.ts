import { InjectionResult } from "../constants";
import { Metafile } from "parse-torrent";
import { getRuntimeConfig } from "../runtimeConfig";
import RTorrent from "./RTorrent";

let activeClient: TorrentClient;

export interface TorrentClient {
	inject: (
		newTorrent: Metafile,
		existingTorrent: Metafile
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
