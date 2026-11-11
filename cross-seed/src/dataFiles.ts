import { replaceEnsembleEntries } from "./ensemble.js";
import { watchDataDir, type DataDirWatcher } from "./dataDirWatcher.js";
import { runInBackground } from "./utils/background.js";
import { readdir, readFile, stat } from "fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "path";
import {
	BOOK_EXTENSIONS,
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
import { getRuntimeConfig, type RuntimeConfig } from "./runtimeConfig.js";
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
import { createDataPathFilter, type DataPathFilter } from "./sourcePaths.js";

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

// Ebook extensions a standalone file can have to be its own searchee; .html is
// left out, it is far more often a stray readme than a book torrent.
const STANDALONE_BOOK_EXTENSIONS = BOOK_EXTENSIONS.filter(
	(ext) => ext !== ".html",
);

const watchers: Map<string, DataDirWatcher> = new Map();
const closingWatchers = new Set<Promise<void>>();
const modifiedPaths: Map<string, Set<string>> = new Map();
const modifiedPathTimes: Map<string, Map<string, number>> = new Map();
const STABILITY_WINDOW_MS = 60_000;
const WATCHER_RETRY_MS = 1000;
const WATCHER_ERROR_LOG_INTERVAL_MS = 60_000;
const watcherErrorTimes = new Map<string, number>();
const failedDataDirs = new Set<string>();
const watcherRetries = new Map<string, NodeJS.Timeout>();

function closeWatcher(watcher: DataDirWatcher): void {
	const closing = watcher.close();
	closingWatchers.add(closing);
	runInBackground(closing.finally(() => closingWatchers.delete(closing)));
}

export async function destroyDataDirWatchers(): Promise<void> {
	for (const timer of watcherRetries.values()) clearTimeout(timer);
	watcherRetries.clear();
	watcherErrorTimes.clear();
	failedDataDirs.clear();
	const oldWatchers = [...watchers.values()];
	watchers.clear();
	for (const watcher of oldWatchers) closeWatcher(watcher);
	modifiedPaths.clear();
	modifiedPathTimes.clear();
	await Promise.all([...closingWatchers]);
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

async function createWatcher(
	dataDir: string,
	onRecovery?: () => Promise<void>,
	recovering = false,
): Promise<void> {
	const retry = (e: Error) => {
		const lastError = watcherErrorTimes.get(dataDir);
		if (
			lastError === undefined ||
			Date.now() - lastError >= WATCHER_ERROR_LOG_INTERVAL_MS
		) {
			logger.error(
				`Retrying watcher for dataDir ${dataDir}: ${e.message}`,
			);
			logger.debug(e);
			watcherErrorTimes.set(dataDir, Date.now());
		}
		failedDataDirs.add(dataDir);
		const previous = watchers.get(dataDir);
		watchers.delete(dataDir);
		if (previous) closeWatcher(previous);
		if (watcherRetries.has(dataDir)) return;
		const timer = setTimeout(() => {
			watcherRetries.delete(dataDir);
			runInBackground(createWatcher(dataDir, onRecovery, true));
		}, WATCHER_RETRY_MS);
		timer.unref();
		watcherRetries.set(dataDir, timer);
	};
	let watcher: DataDirWatcher | undefined;
	try {
		watcher = watchDataDir(dataDir, (f) => {
			if (!f || watchers.get(dataDir) !== watcher) return;
			const fullPath = resolve(join(dataDir, f));
			if (fullPath === resolve(dataDir)) return;
			modifiedPaths.get(dataDir)!.add(fullPath);
			modifiedPathTimes.get(dataDir)!.set(fullPath, Date.now());
		});
		watchers.set(dataDir, watcher);
		watcher.on("error", (e: Error) => {
			if (watchers.get(dataDir) === watcher) retry(e);
		});
		await watcher.ready;
		if (watchers.get(dataDir) !== watcher) return;
		// Wait for the worker to install its subscription before scanning. Events
		// during an outage cannot be recovered by reopening the watcher alone.
		failedDataDirs.add(dataDir);
		if (recovering) {
			logger.info({
				label: Label.INDEX,
				message: `Watcher recovered for dataDir ${dataDir}; refreshing inventory`,
			});
			if (onRecovery)
				onRecovery().catch((error: unknown) => {
					logger.error(
						`Unable to refresh recovered dataDir ${dataDir}: ${errorMessage(error)}`,
					);
				});
		}
	} catch (e) {
		if (!watcher || watchers.get(dataDir) === watcher) retry(e as Error);
	}
}

async function retireExcludedDataPaths(
	includePath: DataPathFilter,
): Promise<void> {
	for (const table of ["data", "ensemble"] as const) {
		let cursor: string | undefined;
		for (;;) {
			const query = db<{ path: string }>(table)
				.distinct("path")
				.whereNotNull("path")
				.orderBy("path")
				.limit(500);
			if (table === "ensemble") query.whereNull("client_host");
			if (cursor !== undefined) query.where("path", ">", cursor);
			const rows = await query;
			if (!rows.length) break;
			cursor = rows[rows.length - 1].path;
			const excluded = await filterAsync(
				rows.map((row) => row.path),
				async (path) => !(await includePath(path)),
			);
			if (excluded.length) {
				const removal = db(table).whereIn("path", excluded);
				if (table === "ensemble") removal.whereNull("client_host");
				await removal.del();
				if (table === "data")
					await markLibraryItemsMissingBySourceKeys(
						excluded.map(createDataLibrarySourceKey),
					);
			}
			await yieldToEventLoop();
		}
	}
}

export async function indexDataDirs(options: {
	startup: boolean;
	onWatcherRecovery?: () => Promise<void>;
}): Promise<void> {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	const includePath = await createDataPathFilter();
	if (options.startup) await destroyDataDirWatchers();
	if (!dataDirs.length) return;
	if (options.startup && includePath.hasExcludedSubtrees)
		await retireExcludedDataPaths(includePath);

	for (const dataDir of dataDirs) {
		if (!options.startup && !failedDataDirs.has(dataDir)) continue;
		if (options.startup) {
			modifiedPaths.set(dataDir, new Set());
			modifiedPathTimes.set(dataDir, new Map());
			await createWatcher(dataDir, options.onWatcherRecovery);
		}
		// Consume this scan request before awaiting: a watcher recovery during the
		// scan must remain pending for the scheduler's next pass.
		failedDataDirs.delete(dataDir);
		const scan = await beginLibraryScan({
			source: LibraryItemSource.DATA,
			sourceInstance: dataDir,
		});
		try {
			const candidates = await findSearcheeCandidatesFromDataDir(
				dataDir,
				maxDataDepth,
				includePath,
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
			if (await includePath(path)) eventPaths.push(path);
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
	const includePath = await createDataPathFilter();
	const dataDirs = options.dataDirs ?? getRuntimeConfig().dataDirs;
	const memoizedPaths = new Map<string, string[]>();
	const memoizedLengths = new Map<string, number>();
	const dataRows: DataEntry[] = [];
	const ensembleRows: EnsembleEntry[] = [];
	const libraryItems: LibraryItemInput[] = [];
	let processed = 0;
	for (const path of paths) {
		if (!(await includePath(path))) continue;
		processed += 1;
		if (processed % 500 === 0) {
			await yieldToEventLoop();
		}
		const files =
			options.precomputedFiles?.get(path) ??
			(await getFilesFromDataRoot(
				path,
				memoizedPaths,
				memoizedLengths,
				includePath,
			));
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
	await replaceEnsembleEntries(db, ensembleRows);
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

export function shouldIgnorePathHeuristically(
	root: string,
	isDir: boolean,
	configOverride: Partial<RuntimeConfig> = {},
) {
	const searchBasename = basename(root);
	if (isDir) {
		return IGNORED_FOLDERS_SUBSTRINGS.includes(
			searchBasename.toLowerCase(),
		);
	} else if (VIDEO_EXTENSIONS.includes(extname(searchBasename))) {
		return false;
	} else {
		// A lone ebook is a torrent of its own: keep it when non-videos are wanted
		return !(
			STANDALONE_BOOK_EXTENSIONS.includes(extname(searchBasename)) &&
			getRuntimeConfig(configOverride).includeNonVideos
		);
	}
}

export async function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean,
	includePath?: DataPathFilter,
	configOverride: Partial<RuntimeConfig> = {},
): Promise<string[]> {
	includePath ??= await createDataPathFilter();
	if (!(await includePath(root))) return [];
	try {
		const isDir =
			isDirHint !== undefined
				? isDirHint
				: (await stat(root)).isDirectory();
		if (
			depth <= 0 ||
			shouldIgnorePathHeuristically(root, isDir, configOverride)
		) {
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
						includePath,
						configOverride,
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
	isDirHint: boolean | undefined,
	includePath: DataPathFilter,
): Promise<{ candidates: DataRootCandidate[]; files: DataFileStat[] }> {
	if (!(await includePath(root))) return { candidates: [], files: [] };
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
				includePath,
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
	includePath: DataPathFilter,
): Promise<DataRootCandidate[]> {
	return flatMapAsync(await readdir(dataDir), async (dirent) => {
		const result = await collectPotentialNestedRootCandidates(
			join(dataDir, dirent),
			maxDataDepth,
			undefined,
			includePath,
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
