import { readdirSync, statSync } from "fs";
import { basename, extname, join } from "path";
import {
	BADFOLDERS_REGEX,
	IGNORED_FOLDERS,
	VIDEO_EXTENSIONS,
} from "./constants.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

function checkIgnorePath(root: string, isDir: boolean) {
	return (
		(isDir &&
			(IGNORED_FOLDERS.includes(basename(root).toLowerCase()) ||
				BADFOLDERS_REGEX.test(basename(root)))) ||
		(!isDir && !VIDEO_EXTENSIONS.includes(extname(basename(root))))
	);
}
export function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean
): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();
	if (checkIgnorePath(root, isDir)) {
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
	} else {
		return [root];
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
