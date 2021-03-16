import { InjectionResult } from "../constants";
import { Metafile } from "parse-torrent";
import { getRuntimeConfig } from "../runtimeConfig";

let activeClient: DownloadClient;

export interface DownloadClient {
	inject: (
		newTorrent: Metafile,
		existingTorrent: Metafile
	) => Promise<InjectionResult>;
	validateConfig: () => Promise<void>;
}

function instantiateDownloadClient() {
	const { action } = getRuntimeConfig();
}

export function getDownloadClient() {
	if (!activeClient) {
		instantiateDownloadClient();
	}
}
