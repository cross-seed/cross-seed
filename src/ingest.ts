import { resolve } from "path";
import QBittorrent from "./clients/QBittorrent.js";
import { findSearcheesFromAllDataDirs } from "./dataFiles.js";
import { db } from "./db.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	createSearcheeFromTorrentFile,
	Searchee,
} from "./searchee.js";
import { loadTorrentDirLight } from "./torrent.js";

async function persist(searchee: Searchee) {
	await db.transaction(async (trx) => {
		const [{ id: searcheeId }] = await trx("searchee")
			.insert(
				[
					{
						name: searchee.name,
						data_root: searchee.path
							? resolve(searchee.path)
							: null,
					},
				],
				["id"]
			)
			.onConflict("name")
			.merge(["data_root"]);
		await trx("file")
			.insert(
				searchee.files.map((file) => ({
					searchee_id: searcheeId,
					name: file.name,
					path: resolve(file.path),
					length: file.length,
				}))
			)
			.onConflict()
			.ignore();

		if (searchee.infoHash) {
			await trx("torrent")
				.insert({
					searchee_id: searcheeId,
					info_hash: searchee.infoHash,
				})
				.onConflict()
				.ignore();
		}
	});
}

async function getAllSearchees() {
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
			const searchees = await QBittorrent.instance().loadSearchees();
			console.log(searchees);
			allSearchees.push(...searchees);
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
	return allSearchees;
}

export async function ingest() {
	const searchees = await getAllSearchees();
	for (const searchee of searchees) {
		await persist(searchee);
	}
}
