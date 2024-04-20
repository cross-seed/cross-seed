import { readdirSync, statSync } from "fs";
import { basename, extname, join } from "path";
import {
	IGNORED_FOLDERS_SUBSTRINGS,
	IGNORED_FOLDERS_REGEX,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

function shouldIgnorePathHeuristically(root: string, isDir: boolean) {
	const folderBaseName = basename(root);
	if (isDir) {
		return (
			IGNORED_FOLDERS_SUBSTRINGS.includes(folderBaseName.toLowerCase()) ||
			IGNORED_FOLDERS_REGEX.test(folderBaseName)
		);
	} else {
		return !VIDEO_EXTENSIONS.includes(extname(folderBaseName));
	}
}
export function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean,
): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
	if (depth <= 0 || shouldIgnorePathHeuristically(root, isDir)) {
		return [];
	}
	// if depth is 0, don't look at children
	else if (depth > 0 && isDir) {
		const directChildren = readdirSync(root, { withFileTypes: true });
		const allDescendants = directChildren.flatMap((dirent) =>
			findPotentialNestedRoots(
				join(root, dirent.name),
				depth - 1,
				dirent.isDirectory(),
			),
		);
		return [root, ...allDescendants];
	} else {
		return [root];
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
