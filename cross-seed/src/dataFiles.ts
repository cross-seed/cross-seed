import { FSWatcher, watch } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "path";
import {
	IGNORED_FOLDERS_SUBSTRINGS,
	LEVENSHTEIN_DIVISOR,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { db } from "./db.js";
import {
	beginLibraryScan,
	completeLibraryScan,
	failLibraryScan,
	createLibraryFileInputs,
	createDataLibraryItemInput,
	createDataLibrarySourceKey,
	LibraryItemSource,
	markLibraryItemsMissingBySourceKeys,
	syncLibraryItems,
} from "./libraryInventory.js";
import type { LibraryItemInput } from "./libraryInventory.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	File,
	getFilesFromDataRoot,
	parseTitle,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import { createEnsemblePieces, EnsembleEntry } from "./torrent.js";
import {
	createKeyTitle,
	errorMessage,
	exists,
	filterAsync,
	filterAsyncYield,
	flatMapAsync,
	inBatches,
	isChildPath,
	isTruthy,
	mapAsync,
	yieldToEventLoop,
	stripExtension,
} from "./utils.js";
import { isOk } from "./Result.js";
import { distance } from "fastest-levenshtein";

interface DataEntry {
	title: string;
	path: string;
}

interface DataFileStat {
	path: string;
	name: string;
	length: number;
}

interface DataRootCandidate {
	path: string;
	files: File[];
}

const watchers: Map<string, FSWatcher> = new Map();
const modifiedPaths: Map<string, Set<string>> = new Map();
const modifiedPathTimes: Map<string, Map<string, number>> = new Map();
const STABILITY_WINDOW_MS = 60_000;
const WATCHER_RETRY_MS = 1000;
const failedDataDirs = new Set<string>();
const watcherRetries = new Map<string, NodeJS.Timeout>();

export function destroyDataDirWatchers(): void {
	for (const timer of watcherRetries.values()) clearTimeout(timer);
	watcherRetries.clear();
	failedDataDirs.clear();
	for (const watcher of watchers.values()) watcher.close();
	watchers.clear();
	modifiedPaths.clear();
	modifiedPathTimes.clear();
}

function getDataSourceInstance(path: string, dataDirs: string[]): string {
	return (
		dataDirs.find(
			(dataDir) =>
				resolve(path) === resolve(dataDir) ||
				isChildPath(path, [dataDir]),
		) ??
		dataDirs[0] ??
		path
	);
}

function createWatcher(dataDir: string): void {
	const retry = (e: Error) => {
		logger.error(`Retrying watcher for dataDir ${dataDir}: ${e.message}`);
		logger.debug(e);
		watchers.get(dataDir)?.close();
		watchers.delete(dataDir);
		if (watcherRetries.has(dataDir)) return;
		const timer = setTimeout(() => {
			watcherRetries.delete(dataDir);
			createWatcher(dataDir);
		}, WATCHER_RETRY_MS);
		timer.unref();
		watcherRetries.set(dataDir, timer);
	};
	try {
		const watcher = watch(
			dataDir,
			{ recursive: true, persistent: false },
			(_, f) => {
				if (!f || watchers.get(dataDir) !== watcher) return;
				const fullPath = resolve(join(dataDir, f));
				if (fullPath === resolve(dataDir)) return;
				modifiedPaths.get(dataDir)!.add(fullPath);
				modifiedPathTimes.get(dataDir)!.set(fullPath, Date.now());
			},
		);
		watchers.set(dataDir, watcher);
		// Events during an outage cannot be recovered by reopening the watcher.
		failedDataDirs.add(dataDir);
		watcher.on("error", (e) => {
			if (watchers.get(dataDir) === watcher) retry(e);
		});
	} catch (e) {
		retry(e as Error);
	}
}

export async function indexDataDirs(options: {
	startup: boolean;
}): Promise<void> {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	if (options.startup) destroyDataDirWatchers();
	if (!dataDirs.length) return;

	for (const dataDir of dataDirs) {
		if (!options.startup && !failedDataDirs.has(dataDir)) continue;
		if (options.startup) {
			modifiedPaths.set(dataDir, new Set());
			modifiedPathTimes.set(dataDir, new Map());
			createWatcher(dataDir);
		}
		const scan = await beginLibraryScan({
			source: LibraryItemSource.DATA,
			sourceInstance: dataDir,
		});
		try {
			const candidates = await findSearcheeCandidatesFromDataDir(
				dataDir,
				maxDataDepth,
			);
			const maxUserWatchesPath = "/proc/sys/fs/inotify/max_user_watches";
			if (await exists(maxUserWatchesPath)) {
				const limit = parseInt(
					await readFile(maxUserWatchesPath, "utf8"),
				);
				if (limit < candidates.length * 2) {
					logger.error(
						`max_user_watches too low for proper indexing of dataDirs. It is recommended to set fs.inotify.max_user_watches=1048576 in /etc/sysctl.conf (only on the host system if using docker) - current: ${limit}`,
					);
				}
			}
			const count = await indexDataPaths(
				candidates.map((candidate) => candidate.path),
				{
					pruneMissing: true,
					dataDirs: [dataDir],
					scanId: scan.id,
					precomputedFiles: new Map(
						candidates.map((candidate) => [
							candidate.path,
							candidate.files,
						]),
					),
				},
			);
			failedDataDirs.delete(dataDir);
			logger.info({
				label: Label.INDEX,
				message: `Validated ${count} entries from dataDir ${dataDir}`,
			});
		} catch (error) {
			failedDataDirs.add(dataDir);
			await failLibraryScan(scan.id, error);
			logger.error({
				label: Label.INDEX,
				message: `Unable to index dataDir ${dataDir}; keeping previous inventory: ${errorMessage(error)}`,
			});
			logger.debug(error);
		}
	}

	await mapAsync(dataDirs, async (dataDir) => {
		if (failedDataDirs.has(dataDir)) return;
		const modified = modifiedPaths.get(dataDir)!;
		const modifiedTimes = modifiedPathTimes.get(dataDir)!;
		const eventPaths: string[] = [];
		const now = Date.now();
		for (const path of modified) {
			const lastSeen = modifiedTimes.get(path) ?? 0;
			if (now - lastSeen < STABILITY_WINDOW_MS) continue;
			if (!modified.delete(path)) continue;
			modifiedTimes.delete(path);
			eventPaths.push(path);
		}
		if (!eventPaths.length) return;
		const scan = await beginLibraryScan({
			source: LibraryItemSource.DATA,
			sourceInstance: dataDir,
		});
		try {
			await readdir(dataDir); // An unavailable source is not a set of deleted files.
			logger.verbose(
				`Indexing dataDir ${dataDir} due to recent changes...`,
			);
			eventPaths.sort(
				(a, b) =>
					b.split(sep).filter(isTruthy).length -
					a.split(sep).filter(isTruthy).length,
			);
			const deletedPaths: string[] = [];
			const paths = await filterAsync(
				Array.from(
					eventPaths.reduce<Set<string>>((acc, path) => {
						const affectedPaths: string[] = [path];
						let parentPath = dirname(path);
						while (resolve(parentPath) !== resolve(dataDir)) {
							affectedPaths.push(parentPath);
							parentPath = dirname(parentPath);
						}
						for (const affectedPath of affectedPaths.slice(
							-maxDataDepth,
						)) {
							acc.add(affectedPath);
						}
						return acc;
					}, new Set()),
				),
				async (path) => {
					if (await exists(path)) return true;
					deletedPaths.push(path);
					return false;
				},
			);
			await inBatches(deletedPaths, async (batch) => {
				await db("data").whereIn("path", batch).del();
				await db("ensemble").whereIn("path", batch).del();
				await markLibraryItemsMissingBySourceKeys(
					batch.map(createDataLibrarySourceKey),
				);
			});
			await indexDataPaths(paths, {
				dataDirs: [dataDir],
				scanId: scan.id,
			});
			// A removal-only update has no items to sync.
			await completeLibraryScan(scan.id);
		} catch (error) {
			failedDataDirs.add(dataDir);
			await failLibraryScan(scan.id, error);
			logger.error({
				label: Label.INDEX,
				message: `Unable to refresh dataDir ${dataDir}: ${errorMessage(error)}`,
			});
		}
	});
}

/**
 * Adds the data and ensemble entries to the database.
 * @param paths The paths to index.
 */
async function indexDataPaths(
	paths: string[],
	options: {
		pruneMissing?: boolean;
		dataDirs?: string[];
		scanId?: number;
		precomputedFiles?: Map<string, File[]>;
	} = {},
): Promise<number> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	const dataDirs = options.dataDirs ?? getRuntimeConfig().dataDirs;
	const memoizedPaths = new Map<string, string[]>();
	const memoizedLengths = new Map<string, number>();
	const dataRows: DataEntry[] = [];
	const ensembleRows: EnsembleEntry[] = [];
	const libraryItems: LibraryItemInput[] = [];
	let processed = 0;
	for (const path of paths) {
		processed += 1;
		if (processed % 500 === 0) {
			await yieldToEventLoop();
		}
		const files =
			options.precomputedFiles?.get(path) ??
			(await getFilesFromDataRoot(path, memoizedPaths, memoizedLengths));
		if (!files.length) continue;
		const title = parseTitle(basename(path), files, path);
		if (!title) continue;
		const libraryItem = createDataLibraryItemInput(
			{
				infoHash: undefined,
				path,
				files,
				name: basename(path),
				title,
				length: files.reduce((sum, file) => sum + file.length, 0),
			},
			getDataSourceInstance(path, dataDirs),
		);
		libraryItems.push(libraryItem);
		dataRows.push({ title, path });
		if (seasonFromEpisodes) {
			const ensembleEntries = indexEnsembleDataEntry(title, path, files);
			if (ensembleEntries) ensembleRows.push(...ensembleEntries);
		}
	}
	await inBatches(dataRows, async (batch) => {
		await db("data").insert(batch).onConflict("path").merge();
	});
	await inBatches(ensembleRows, async (batch) => {
		await db("ensemble")
			.insert(batch)
			.onConflict(["client_host", "path"])
			.merge();
	});
	const itemsBySourceInstance = new Map<string | null, LibraryItemInput[]>();
	for (const item of libraryItems) {
		const sourceInstance = item.sourceInstance ?? null;
		const items = itemsBySourceInstance.get(sourceInstance) ?? [];
		items.push(item);
		itemsBySourceInstance.set(sourceInstance, items);
	}
	for (const [sourceInstance, items] of itemsBySourceInstance) {
		await syncLibraryItems({
			scanId: options.scanId,
			source: LibraryItemSource.DATA,
			sourceInstance,
			itemsToUpsert: items,
			filesToUpsert: items.flatMap(createLibraryFileInputs),
			pruneMissing: options.pruneMissing ?? false,
		});
	}
	if (options.pruneMissing) {
		for (const dataDir of dataDirs) {
			if (itemsBySourceInstance.has(dataDir)) continue;
			await syncLibraryItems({
				scanId: options.scanId,
				source: LibraryItemSource.DATA,
				sourceInstance: dataDir,
				pruneMissing: true,
			});
		}
	}
	return dataRows.length;
}

function indexEnsembleDataEntry(
	title: string,
	path: string,
	files: File[],
): EnsembleEntry[] | null {
	const ensemblePieces = createEnsemblePieces(title, files);
	if (!ensemblePieces || !ensemblePieces.length) return null;
	return ensemblePieces.map((ensemblePiece) => ({
		client_host: null,
		path: join(dirname(path), ensemblePiece.largestFile.path),
		info_hash: null,
		ensemble: ensemblePiece.key,
		element: ensemblePiece.element,
	}));
}

export async function getDataByFuzzyName(
	stem: string,
): Promise<SearcheeWithoutInfoHash[]> {
	const allDataEntries: DataEntry[] = await db("data");
	const fullMatch = createKeyTitle(stem);

	// Attempt to filter torrents in DB to match incoming data before fuzzy check
	let filteredNames: DataEntry[] = [];
	if (fullMatch) {
		filteredNames = await filterAsyncYield(allDataEntries, (dbData) => {
			const dbMatch = createKeyTitle(stripExtension(dbData.title));
			return Promise.resolve(fullMatch === dbMatch);
		});
	}

	// If none match, proceed with fuzzy name check on all names.
	filteredNames = filteredNames.length > 0 ? filteredNames : allDataEntries;

	const entriesToDelete: string[] = [];

	const candidateMaxDistance = Math.floor(stem.length / LEVENSHTEIN_DIVISOR);
	const potentialMatches = await filterAsyncYield(
		filteredNames,
		async (dbEntry) => {
			const dbTitle = stripExtension(dbEntry.title);
			const maxDistance = Math.min(
				candidateMaxDistance,
				Math.floor(dbTitle.length / LEVENSHTEIN_DIVISOR),
			);
			if (distance(stem, dbTitle) > maxDistance) return false;
			if (await exists(dbEntry.path)) return true;
			entriesToDelete.push(dbEntry.path);
			return false;
		},
	);

	await inBatches(entriesToDelete, async (batch) => {
		await db("data").whereIn("path", batch).del();
		await db("ensemble").whereIn("path", batch).del();
		await markLibraryItemsMissingBySourceKeys(
			batch.map(createDataLibrarySourceKey),
		);
	});
	return (
		await mapAsync(potentialMatches, (dbData) =>
			createSearcheeFromPath(dbData.path),
		)
	)
		.filter(isOk)
		.map((r) => r.unwrap());
}

export function shouldIgnorePathHeuristically(root: string, isDir: boolean) {
	const searchBasename = basename(root);
	if (isDir) {
		return IGNORED_FOLDERS_SUBSTRINGS.includes(
			searchBasename.toLowerCase(),
		);
	} else {
		return !VIDEO_EXTENSIONS.includes(extname(searchBasename));
	}
}

export async function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean,
): Promise<string[]> {
	try {
		const isDir =
			isDirHint !== undefined
				? isDirHint
				: (await stat(root)).isDirectory();
		if (depth <= 0 || shouldIgnorePathHeuristically(root, isDir)) {
			return [];
		} else if (depth > 0 && isDir) {
			const directChildren = await readdir(root, { withFileTypes: true });
			const allDescendants = await flatMapAsync(
				directChildren,
				(dirent) =>
					findPotentialNestedRoots(
						join(root, dirent.name),
						depth - 1,
						dirent.isDirectory(),
					),
			);
			return [...allDescendants, root]; // deepest paths first for memoization
		} else {
			return [root];
		}
	} catch (e) {
		logger.verbose(`Failed to process path ${root}: ${errorMessage(e)}`);
		logger.debug(e);
		return [];
	}
}

function createFilesForRoot(root: string, files: DataFileStat[]): File[] {
	const parentDir = dirname(root);
	return files.map((file) => ({
		path: relative(parentDir, file.path),
		name: file.name,
		length: file.length,
	}));
}

async function collectPotentialNestedRootCandidates(
	root: string,
	depth: number,
	isDirHint?: boolean,
): Promise<{ candidates: DataRootCandidate[]; files: DataFileStat[] }> {
	try {
		const rootStat = isDirHint !== undefined ? null : await stat(root);
		const isDir =
			isDirHint !== undefined ? isDirHint : rootStat!.isDirectory();

		if (!isDir) {
			const fileStat = rootStat ?? (await stat(root));
			const files = [
				{
					path: root,
					name: basename(root),
					length: fileStat.size,
				},
			];
			if (depth <= 0 || shouldIgnorePathHeuristically(root, isDir)) {
				return { candidates: [], files };
			}
			return {
				candidates: [
					{ path: root, files: createFilesForRoot(root, files) },
				],
				files,
			};
		}

		const directChildren = await readdir(root, { withFileTypes: true });
		const childResults = await mapAsync(directChildren, (dirent) =>
			collectPotentialNestedRootCandidates(
				join(root, dirent.name),
				depth - 1,
				dirent.isDirectory(),
			),
		);
		const files = childResults.flatMap((result) => result.files);
		const candidates = childResults.flatMap((result) => result.candidates);
		if (depth <= 0 || shouldIgnorePathHeuristically(root, isDir)) {
			return { candidates: [], files };
		}
		return {
			candidates: [
				...candidates,
				{ path: root, files: createFilesForRoot(root, files) },
			],
			files,
		};
	} catch (e) {
		logger.verbose(`Failed to process path ${root}: ${errorMessage(e)}`);
		logger.debug(e);
		throw e;
	}
}

async function findSearcheeCandidatesFromDataDir(
	dataDir: string,
	maxDataDepth: number,
): Promise<DataRootCandidate[]> {
	return flatMapAsync(await readdir(dataDir), async (dirent) => {
		const result = await collectPotentialNestedRootCandidates(
			join(dataDir, dirent),
			maxDataDepth,
		);
		return result.candidates;
	});
}

export async function findSearcheesFromAllDataDirs(): Promise<string[]> {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	return flatMapAsync(dataDirs, async (dataDir) =>
		flatMapAsync(
			(await readdir(dataDir)).map((dirent) => join(dataDir, dirent)),
			(path) => findPotentialNestedRoots(path, maxDataDepth),
		),
	);
}
