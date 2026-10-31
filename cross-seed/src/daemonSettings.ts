import { db } from "./db.js";
import { createSettingsService } from "./settingsService.js";
import { createKnexSettingsPersistence } from "./settingsPersistence.js";
import {
	getRuntimeConfig,
	setRuntimeConfig,
	type RuntimeConfig,
} from "./runtimeConfig.js";
import { reloadDownloadClients } from "./clients/TorrentClient.js";
import { indexTorrentsAndDataDirs } from "./torrent.js";
import { Label, logger } from "./logger.js";
import { errorMessage } from "./utils.js";

function arrayContentsChanged(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return true;
	return a.some((value, index) => value !== b[index]);
}

function torrentSourceConfigChanged(
	before: RuntimeConfig,
	after: RuntimeConfig,
): boolean {
	return (
		before.useClientTorrents !== after.useClientTorrents ||
		before.torrentDir !== after.torrentDir ||
		before.outputDir !== after.outputDir ||
		arrayContentsChanged(before.linkDirs, after.linkDirs) ||
		before.maxDataDepth !== after.maxDataDepth ||
		before.seasonFromEpisodes !== after.seasonFromEpisodes ||
		arrayContentsChanged(
			before.torrentClients ?? [],
			after.torrentClients ?? [],
		) ||
		arrayContentsChanged(before.dataDirs ?? [], after.dataDirs ?? [])
	);
}

function triggerLibraryIndexing(): void {
	void indexTorrentsAndDataDirs({ startup: true }).catch((error) => {
		logger.error({
			label: Label.INDEX,
			message: `Failed to index library after source config update: ${errorMessage(error)}`,
		});
		logger.debug(error);
	});
}

export const daemonSettingsService = createSettingsService(
	createKnexSettingsPersistence(db),
	{
		afterWrite(config) {
			const previous = getRuntimeConfig();
			setRuntimeConfig(config);
			reloadDownloadClients();
			if (torrentSourceConfigChanged(previous, config))
				triggerLibraryIndexing();
		},
	},
);
