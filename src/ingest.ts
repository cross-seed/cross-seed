import QBittorrent from "./clients/QBittorrent.js";
import { findSearcheesFromAllDataDirs } from "./dataFiles.js";
import { Label, logger } from "./logger.js";
import { filterByContent, filterDupes, filterTimestamps } from "./preFilter.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	Searchee,
} from "./searchee.js";
import { loadTorrentDirLight } from "./torrent.js";
import { filterAsync } from "./utils.js";

async function findSearchableTorrents() {
	const {
		torrents,
		dataDirs,
		torrentDir,
		searchLimit,
		qbittorrentCategories,
	} = getRuntimeConfig();
	let allSearchees: Searchee[] = [];
	if (Array.isArray(torrents)) {
		const searcheeResults = await Promise.all(
			torrents.map(createSearcheeFromTorrentFile) //also create searchee from path
		);
		allSearchees = searcheeResults
			.filter((t) => t.isOk())
			.map((t) => t.unwrapOrThrow());
	} else {
		if (Array.isArray(qbittorrentCategories)) {
			allSearchees.push(
				...(await QBittorrent.instance().loadSearchees())
			);
		} else if (typeof torrentDir === "string") {
			allSearchees.push(...(await loadTorrentDirLight()));
		}
		if (Array.isArray(dataDirs)) {
			const searcheeResults = await Promise.all(
				findSearcheesFromAllDataDirs().map(createSearcheeFromPath)
			);
			allSearchees.push(
				...searcheeResults
					.filter((t) => t.isOk())
					.map((t) => t.unwrapOrThrow())
			);
		}
	}

	const hashesToExclude = allSearchees.map((t) => t.infoHash).filter(Boolean);
	let filteredTorrents = await filterAsync(
		filterDupes(allSearchees).filter(filterByContent),
		filterTimestamps
	);

	logger.info({
		label: Label.SEARCH,
		message: `Found ${allSearchees.length} torrents, ${filteredTorrents.length} suitable to search for matches`,
	});

	if (searchLimit && filteredTorrents.length > searchLimit) {
		logger.info({
			label: Label.SEARCH,
			message: `Limited to ${searchLimit} searches`,
		});

		filteredTorrents = filteredTorrents.slice(0, searchLimit);
	}

	return { samples: filteredTorrents, hashesToExclude };
}
