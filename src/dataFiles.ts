import { existsSync, FSWatcher, readdirSync, statSync, watch } from "fs";
import Fuse from "fuse.js";
import { basename, dirname, extname, join, resolve, sep } from "path";
import { IGNORED_FOLDERS_SUBSTRINGS, VIDEO_EXTENSIONS } from "./constants.js";
import { memDB } from "./db.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	File,
	getFilesFromDataRoot,
	parseTitle,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import { createEnsemblePieces, EnsembleEntry } from "./torrent.js";
import { createKeyTitle, isTruthy } from "./utils.js";
import { isOk } from "./Result.js";

interface DataEntry {
	title: string;
	path: string;
}

const watchers: Map<string, FSWatcher> = new Map();
const modifiedPaths: Map<string, Set<string>> = new Map();

/**
 * Only call this function once at the start of the program.
 */
export async function initializeDataDirs(): Promise<void> {
	const { dataDirs } = getRuntimeConfig();
	if (!dataDirs?.length) return;
	for (const dataDir of dataDirs) {
		modifiedPaths.set(dataDir, new Set());
		watchers.set(
			dataDir,
			watch(dataDir, { recursive: true, persistent: false }, (_, f) => {
				if (!f) return;
				const fullPath = resolve(join(dataDir, f));
				if (fullPath === resolve(dataDir)) return;
				modifiedPaths.get(dataDir)!.add(fullPath);
			}),
		);
	}
	logger.info("Indexing dataDirs for reverse lookup...");
	await indexDataPaths(findSearcheesFromAllDataDirs());
}

/**
 * This gets called on each rss/webhook/announce event.
 */
export async function indexDataDirs(): Promise<void> {
	const { maxDataDepth } = getRuntimeConfig();
	await Promise.all(
		Array.from(watchers.keys()).map((dataDir) => {
			const modified = modifiedPaths.get(dataDir)!;
			const eventPaths: string[] = [];
			while (modified.size) {
				const path: string | undefined = modified.values().next().value;
				if (!path) continue;
				if (!modified.delete(path)) continue;
				eventPaths.push(path);
			}
			if (!eventPaths.length) return;
			logger.verbose(
				`Indexing dataDir ${dataDir} due to recent changes...`,
			);
			eventPaths.sort(
				(a, b) =>
					b.split(sep).filter(isTruthy).length -
					a.split(sep).filter(isTruthy).length,
			);
			const seenPaths = new Set<string>();
			const paths = eventPaths.reduce<string[]>((acc, path) => {
				const affectedPaths: string[] = [path];
				let parentPath = dirname(path);
				while (resolve(parentPath) !== resolve(dataDir)) {
					affectedPaths.push(parentPath);
					parentPath = dirname(parentPath);
				}
				for (const affectedPath of affectedPaths.slice(-maxDataDepth)) {
					if (seenPaths.has(affectedPath)) continue;
					seenPaths.add(affectedPath);
					acc.push(affectedPath);
				}
				return acc;
			}, []);
			return indexDataPaths(paths);
		}),
	);
}

/**
 * Adds the data and ensemble entries to the database.
 * @param paths The paths to index.
 */
async function indexDataPaths(paths: string[]): Promise<void> {
	const { seasonFromEpisodes } = getRuntimeConfig();
	const memoizedPaths = new Map<string, string[]>();
	const memoizedLengths = new Map<string, number>();
	const dataRows: DataEntry[] = [];
	const ensembleRows: EnsembleEntry[] = [];
	for (const path of paths) {
		const files = getFilesFromDataRoot(
			path,
			memoizedPaths,
			memoizedLengths,
		);
		if (!files.length) continue;
		const title = parseTitle(basename(path), files, path);
		if (!title) continue;
		dataRows.push({ title, path });
		if (seasonFromEpisodes) {
			const ensembleEntry = await indexEnsembleDataEntry(
				title,
				path,
				files,
			);
			if (ensembleEntry) ensembleRows.push(ensembleEntry);
		}
	}
	const batchSize = 100;
	for (let i = 0; i < dataRows.length; i += batchSize) {
		const batch = dataRows.slice(i, i + batchSize);
		if (!batch.length) break;
		await memDB("data").insert(batch).onConflict("path").merge();
	}
	for (let i = 0; i < ensembleRows.length; i += batchSize) {
		const batch = ensembleRows.slice(i, i + batchSize);
		if (!batch.length) break;
		await memDB("ensemble").insert(batch).onConflict("path").merge();
	}
}

async function indexEnsembleDataEntry(
	title: string,
	path: string,
	files: File[],
): Promise<EnsembleEntry | null> {
	const ensemblePieces = await createEnsemblePieces(title, files);
	if (!ensemblePieces) return null;
	const { key, element, largestFile } = ensemblePieces;
	return {
		path: join(dirname(path), largestFile.path),
		ensemble: key,
		element,
	};
}

export async function getDataByFuzzyName(
	name: string,
): Promise<SearcheeWithoutInfoHash[]> {
	const allDataEntries: { title: string; path: string }[] =
		await memDB("data");
	const fullMatch = createKeyTitle(name);

	// Attempt to filter torrents in DB to match incoming data before fuzzy check
	let filteredNames: typeof allDataEntries = [];
	if (fullMatch) {
		filteredNames = allDataEntries.filter((dbData) => {
			const dbMatch = createKeyTitle(dbData.title);
			return fullMatch === dbMatch;
		});
	}

	// If none match, proceed with fuzzy name check on all names.
	filteredNames = filteredNames.length > 0 ? filteredNames : allDataEntries;

	const entriesToDelete: string[] = [];
	// @ts-expect-error fuse types are confused
	const potentialMatches = new Fuse(filteredNames, {
		keys: ["title"],
		distance: 6,
		threshold: 0.25,
	})
		.search(name)
		.filter((match) => {
			const path = match.item.path;
			if (existsSync(path)) return true;
			entriesToDelete.push(path);
			return false;
		});
	if (entriesToDelete.length > 0) {
		await memDB("data").whereIn("path", entriesToDelete).del();
	}
	if (potentialMatches.length === 0) return [];
	return [await createSearcheeFromPath(potentialMatches[0].item.path)]
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

export function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean,
): string[] {
	try {
		const isDir =
			isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
		if (depth <= 0 || shouldIgnorePathHeuristically(root, isDir)) {
			return [];
		} else if (depth > 0 && isDir) {
			const directChildren = readdirSync(root, { withFileTypes: true });
			const allDescendants = directChildren.flatMap((dirent) =>
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
		logger.verbose(`Failed to process path: ${root}`);
		logger.debug(e);
		return [];
	}
}

export function findSearcheesFromAllDataDirs(): string[] {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	return dataDirs!.flatMap((dataDir) =>
		readdirSync(dataDir)
			.map((dirent) => join(dataDir, dirent))
			.flatMap((path) => findPotentialNestedRoots(path, maxDataDepth)),
	);
}
