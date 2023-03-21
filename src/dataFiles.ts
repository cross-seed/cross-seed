import { readdirSync, statSync } from "fs";
import { extname, join } from "path";
import { DATA_EXTENSIONS } from "./constants.js";

export function findPotentialNestedRoots(
	root: string,
	depth: number,
	isDirHint?: boolean
): string[] {
	const isDir =
		isDirHint !== undefined ? isDirHint : statSync(root).isDirectory();

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

export function findSearcheesFromAllDataDirs(dataDirs: string[]): string[] {
	return dataDirs.flatMap((dataDir) =>
		readdirSync(dataDir)
			.map((dirent) => join(dataDir, dirent))
			.flatMap((path) => findPotentialNestedRoots(path, 2))
	);
}
