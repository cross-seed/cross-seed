import {
	existsSync,
	FSWatcher,
	readdirSync,
	readFileSync,
	statSync,
	watch,
} from "fs";
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
import { createKeyTitle, inBatches, isTruthy } from "./utils.js";
import { isOk } from "./Result.js";

interface DataEntry {
	title: string;
	path: string;
}

const watchers: Map<string, FSWatcher> = new Map();
const modifiedPaths: Map<string, Set<string>> = new Map();

function createWatcher(dataDir: string): FSWatcher {
	return watch(dataDir, { recursive: true, persistent: false }, (_, f) => {
		if (!f) return;
		const fullPath = resolve(join(dataDir, f));
		if (fullPath === resolve(dataDir)) return;
		modifiedPaths.get(dataDir)!.add(fullPath);
	}).on("error", (e) => {
		logger.error(`Restarting watcher for dataDir ${dataDir}: ${e.message}`);
		logger.debug(e);
		watchers.get(dataDir)!.close();
		watchers.set(dataDir, createWatcher(dataDir));
	});
}

export async function indexDataDirs(options: {
	startup: boolean;
}): Promise<void> {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	if (!dataDirs.length) return;

	if (options.startup) {
		logger.info("Indexing dataDirs for reverse lookup...");
		for (const dataDir of dataDirs) {
			modifiedPaths.set(dataDir, new Set());
			watchers.set(dataDir, createWatcher(dataDir));
		}
		const searcheePaths = findSearcheesFromAllDataDirs();
		const maxUserWatchesPath = "/proc/sys/fs/inotify/max_user_watches";
		if (existsSync(maxUserWatchesPath)) {
			const limit = parseInt(readFileSync(maxUserWatchesPath, "utf8"));
			if (limit < searcheePaths.length * 10) {
				logger.error(
					`max_user_watches too low for proper indexing of dataDirs. It is recommended to set fs.inotify.max_user_watches=1048576 in /etc/sysctl.conf (only on the host system if using docker) - current: ${limit}`,
				);
			}
		}
		return await indexDataPaths(searcheePaths);
	}

	await Promise.all(
		dataDirs.map(async (dataDir) => {
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
			const deletedPaths: string[] = [];
			const paths = Array.from(
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
			).filter((path) => {
				if (existsSync(path)) return true;
				deletedPaths.push(path);
				return false;
			});
			await inBatches(deletedPaths, async (batch) => {
				await memDB("data").whereIn("path", batch).del();
				await memDB("ensemble").whereIn("path", batch).del();
			});
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
			const ensembleEntries = await indexEnsembleDataEntry(
				title,
				path,
				files,
			);
			if (ensembleEntries) ensembleRows.push(...ensembleEntries);
		}
	}
	await inBatches(dataRows, async (batch) => {
		await memDB("data").insert(batch).onConflict("path").merge();
	});
	await inBatches(ensembleRows, async (batch) => {
		await memDB("ensemble")
			.insert(batch)
			.onConflict(["client_host", "path"])
			.merge();
	});
}

async function indexEnsembleDataEntry(
	title: string,
	path: string,
	files: File[],
): Promise<EnsembleEntry[] | null> {
	const ensemblePieces = await createEnsemblePieces(title, files);
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
	await inBatches(entriesToDelete, async (batch) => {
		await memDB("data").whereIn("path", batch).del();
		await memDB("ensemble").whereIn("path", batch).del();
	});
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
		logger.verbose(`Failed to process path ${root}: ${e.message}`);
		logger.debug(e);
		return [];
	}
}

export function findSearcheesFromAllDataDirs(): string[] {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	return dataDirs.flatMap((dataDir) =>
		readdirSync(dataDir)
			.map((dirent) => join(dataDir, dirent))
			.flatMap((path) => findPotentialNestedRoots(path, maxDataDepth)),
	);
}
