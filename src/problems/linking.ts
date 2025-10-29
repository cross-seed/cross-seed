import { stat } from "fs/promises";

import { testLinking } from "../action.js";
import { Label, logger } from "../logger.js";
import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import {
	buildPathProblem,
	diagnoseDirForProblems,
	PathProblemDescriptor,
} from "./path.js";

async function collectLinkingProblemDescriptors(
	linkDirs: string[],
	dataDirs: string[],
): Promise<PathProblemDescriptor[]> {
	const problems: PathProblemDescriptor[] = [];
	if (!linkDirs.length || !dataDirs.length) return problems;

	const linkDirStats = await Promise.all(
		linkDirs.map(async (dir, index) => {
			const descriptor = await diagnoseDirForProblems(
				dir,
				`linkDir${index}`,
				"linkDirs",
				{ read: true, write: true },
			);
			return {
				path: dir,
				problem: descriptor,
				dev: descriptor ? null : (await stat(dir)).dev,
			};
		}),
	);

	for (const { problem } of linkDirStats) {
		if (problem) problems.push(problem);
	}

	const validLinkDirs = linkDirStats
		.filter(({ problem }) => problem === null)
		.map(({ path, dev }) => ({ path, dev }));

	if (!validLinkDirs.length) return problems;

	for (const [index, dataDir] of dataDirs.entries()) {
		const descriptor = await diagnoseDirForProblems(
			dataDir,
			`dataDir${index}`,
			"dataDirs",
			{ read: true },
		);
		if (descriptor) {
			problems.push(descriptor);
			continue;
		}

		try {
			const dataDev = (await stat(dataDir)).dev;
			const matchingLinkDir = validLinkDirs.find(
				(linkDir) => linkDir.dev === dataDev,
			);
			if (!matchingLinkDir) {
				problems.push({
					category: "linkDirs",
					name: "linkDir",
					path: validLinkDirs.map((dir) => dir.path).join(", "),
					issue: "cross-platform-linking",
					message:
						"No linkDir shares a filesystem with this dataDir, so linking will fail. Add a linkDir on the same device.",
					severity: "error",
				});
				continue;
			}

			const result = await testLinking(
				dataDir,
				`healthCheckSrc.cross-seed`,
				`healthCheckDest.cross-seed`,
			);
			if (!result) {
				problems.push({
					category: "linkDirs",
					name: "linkDir",
					path: matchingLinkDir.path,
					issue: "linking-failed",
					message:
						"Linking test failed. Check filesystem permissions and mounts.",
					severity: "warning",
				});
			}
		} catch (error) {
			logger.debug({ label: Label.INJECT, message: error });
			problems.push({
				category: "linkDirs",
				name: "linkDir",
				path: dataDir,
				issue: "linking-failed",
				message: "Linking test threw an error. See logs for details.",
				severity: "error",
			});
		}
	}

	return problems;
}

export async function collectLinkingProblems(): Promise<Problem[]> {
	const { linkDirs, dataDirs } = getRuntimeConfig();
	const descriptors = await collectLinkingProblemDescriptors(
		linkDirs ?? [],
		dataDirs ?? [],
	);
	return descriptors.map(buildPathProblem);
}
