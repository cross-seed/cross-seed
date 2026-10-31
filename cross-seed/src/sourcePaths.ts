import { realpath } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { RuntimeConfig } from "./runtimeConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { SAVED_TORRENTS_INFO_REGEX, MediaType } from "./constants.js";

export function containsPath(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return (
		rel === "" ||
		(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
	);
}

// Resolve existing ancestors too: a configured destination need not exist yet.
export async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if (
			!["ENOENT", "ENOTDIR"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			throw error;
		const parent = dirname(resolve(path));
		if (parent === resolve(path)) return resolve(path);
		return join(await canonicalPath(parent), basename(path));
	}
}

export function isGeneratedTorrent(path: string): boolean {
	const groups = basename(path).match(SAVED_TORRENTS_INFO_REGEX)?.groups;
	return (
		!!groups &&
		Object.values(MediaType).includes(groups.mediaType as MediaType)
	);
}

/** Exact shared roots cannot distinguish original files from generated links. */
export async function validateSourceLayout(
	config: RuntimeConfig,
): Promise<void> {
	if (!config.dataDirs.length || !config.linkDirs.length) return;
	// Saving settings must remain possible while a mount is unavailable. Resolve
	// aliases when accessible and still catch lexical equality otherwise.
	const identity = (path: string) =>
		canonicalPath(path).catch(() => resolve(path));
	const roots = await Promise.all(config.dataDirs.map(identity));
	for (const linkDir of config.linkDirs) {
		if (roots.includes(await identity(linkDir))) {
			throw new Error(
				"linkDir and dataDir must differ. Use a dedicated link directory inside or outside your data directory; cross-seed automatically excludes nested link directories.",
			);
		}
	}
}

export type DataPathFilter = ((path: string) => Promise<boolean>) & {
	hasExcludedSubtrees: boolean;
};

export async function createDataPathFilter(
	config: RuntimeConfig = getRuntimeConfig(),
): Promise<DataPathFilter> {
	await validateSourceLayout(config);
	const roots = await Promise.all(config.dataDirs.map(canonicalPath));
	const managed = await Promise.all(
		[
			...config.linkDirs,
			config.outputDir,
			...(config.torrentDir ? [config.torrentDir] : []),
		].map(canonicalPath),
	);
	// Explicit source roots win when a destination also contains those sources.
	const excluded = managed.filter((dest) =>
		roots.some((root) => root !== dest && containsPath(root, dest)),
	);
	const excludedAt = (path: string) =>
		excluded.some(
			(dest) =>
				containsPath(dest, path) &&
				!roots.some(
					(root) =>
						containsPath(dest, root) &&
						(containsPath(root, path) || containsPath(path, root)),
				),
		);
	const metadataDirs = await Promise.all(
		[
			config.outputDir,
			...(config.torrentDir ? [config.torrentDir] : []),
		].map(canonicalPath),
	);
	const include = async (path: string) => {
		if (!excluded.length && !path.endsWith(".torrent")) return true;
		const location = join(
			await canonicalPath(dirname(path)),
			basename(path),
		);
		const canonical = await canonicalPath(path);
		return (
			!excludedAt(canonical) &&
			!excludedAt(location) &&
			!(
				canonical.endsWith(".torrent") &&
				(metadataDirs.includes(dirname(canonical)) ||
					metadataDirs.includes(dirname(location)))
			)
		);
	};
	return Object.assign(include, { hasExcludedSubtrees: excluded.length > 0 });
}
