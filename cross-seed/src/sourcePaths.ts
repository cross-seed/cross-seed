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

// If a link root also contains explicit sources, reserve a child destination
// rather than excluding the sources themselves or changing existing torrents.
export async function getEffectiveLinkDirs(
	config: RuntimeConfig = getRuntimeConfig(),
): Promise<string[]> {
	const roots = await Promise.all(config.dataDirs.map(canonicalPath));
	return Promise.all(
		config.linkDirs.map(async (dir) => {
			const canonical = await canonicalPath(dir);
			if (!roots.some((root) => containsPath(canonical, root)))
				return dir;
			for (let suffix = 0; ; suffix++) {
				const candidate = join(
					dir,
					suffix
						? `.cross-seed-links-${suffix}`
						: ".cross-seed-links",
				);
				const target = await canonicalPath(candidate);
				if (!roots.some((root) => containsPath(target, root)))
					return candidate;
			}
		}),
	);
}

export type DataPathFilter = ((path: string) => Promise<boolean>) & {
	hasExcludedSubtrees: boolean;
};

export async function createDataPathFilter(
	config: RuntimeConfig = getRuntimeConfig(),
): Promise<DataPathFilter> {
	const roots = await Promise.all(config.dataDirs.map(canonicalPath));
	const managed = await Promise.all(
		[
			...(await getEffectiveLinkDirs(config)),
			config.outputDir,
			...(config.torrentDir ? [config.torrentDir] : []),
		].map(canonicalPath),
	);
	// Explicit source roots win when a destination also contains those sources.
	const excluded = managed.filter(
		(dest) =>
			roots.some((root) => root !== dest && containsPath(root, dest)) &&
			!roots.some((root) => containsPath(dest, root)),
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
			!excluded.some(
				(dir) =>
					containsPath(dir, canonical) || containsPath(dir, location),
			) &&
			!(
				canonical.endsWith(".torrent") &&
				(metadataDirs.includes(dirname(canonical)) ||
					metadataDirs.includes(dirname(location)))
			)
		);
	};
	return Object.assign(include, { hasExcludedSubtrees: excluded.length > 0 });
}
