import { readdirSync, statSync } from "fs";
import { basename, extname, join } from "path";
import {
	BADFOLDERS_REGEX,
	DATA_EXTENSIONS,
	IGNOREDFILES_REGEX,
} from "./constants.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

export function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean
): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
	if (
		IGNOREDFILES_REGEX.test(basename(root)) ||
		BADFOLDERS_REGEX.test(basename(root))
	) {
		return [];
	}
	// if depth is 0, don't look at children
	if (depth > 0 && isDir) {
		const directChildren = readdirSync(root, { withFileTypes: true });
		const allDescendants = directChildren.flatMap((dirent) =>
			findPotentialNestedRoots(
				join(root, dirent.name),
				depth - 1,
				dirent.isDirectory()
			)
		);
		return [root, ...allDescendants];
	} else if (
		DATA_EXTENSIONS.includes(extname(root)) &&
		!root.includes("sample")
	) {
		return [root];
	} else {
		return [];
	}
}

export function findSearcheesFromAllDataDirs(): string[] {
	const { dataDirs, maxDataDepth } = getRuntimeConfig();
	return dataDirs.flatMap((dataDir) =>
		readdirSync(dataDir)
			.map((dirent) => join(dataDir, dirent))
			.flatMap((path) => findPotentialNestedRoots(path, maxDataDepth))
	);
}
