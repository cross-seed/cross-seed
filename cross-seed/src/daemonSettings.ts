import { getDaemonRecovery, resumeRecoveredDaemon } from "./daemonRecovery.js";
import { reconcileJobs } from "./jobs.js";
import { initializePushNotifier } from "./pushNotifier.js";
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
		beforeWrite() {
			if (getDaemonRecovery()?.source === "file")
				throw new Error(
					"Fix config.js and restart to retry the complete legacy import, including indexers.",
				);
		},
		async afterWrite(config) {
			if (await resumeRecoveredDaemon(config)) {
				logger.info({
					label: Label.SERVER,
					message: "Settings repaired; resuming cross-seed.",
				});
				return;
			}
			const previous = getRuntimeConfig();
			setRuntimeConfig(config);
			reloadDownloadClients();
			reconcileJobs();
			initializePushNotifier();
			if (torrentSourceConfigChanged(previous, config))
				triggerLibraryIndexing();
		},
	},
);
