import { testLinking } from "../action.js";
import { Label, logger } from "../logger.js";
import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import {
	buildPathProblem,
	diagnoseDirForProblems,
	PathProblemDescriptor,
} from "./path.js";

async function collectDataLinkingProblemDescriptors(
	linkDirs: string[],
	dataDirs: string[],
): Promise<PathProblemDescriptor[]> {
	const problems: PathProblemDescriptor[] = [];
	if (!linkDirs.length || !dataDirs.length) return problems;

	const linkDirStats = await Promise.all(
		linkDirs.map(async (dir, index) => {
			const { descriptor, verification } = await diagnoseDirForProblems(
				dir,
				`linkDir${index}`,
				"linkDirs",
				{ read: true, write: true },
			);
			return {
				path: dir,
				problem: descriptor,
				ok: verification.ok,
				dev: verification.ok ? verification.stats.dev : null,
			};
		}),
	);

	for (const { problem } of linkDirStats) {
		if (problem) problems.push(problem);
	}

	const validLinkDirs = linkDirStats
		.filter(({ ok, dev }) => ok && typeof dev === "number")
		.map(({ path, dev }) => ({ path, dev: dev! }));

	if (!validLinkDirs.length) return problems;

	for (const [index, dataDir] of dataDirs.entries()) {
		const { descriptor, verification } = await diagnoseDirForProblems(
			dataDir,
			`dataDir${index}`,
			"dataDirs",
			{ read: true },
		);
		if (!verification.ok) {
			if (descriptor) {
				problems.push(descriptor);
			}
			continue;
		}

		try {
			const dataDev = verification.stats.dev;
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

export async function collectDataLinkingProblems(): Promise<Problem[]> {
	const { linkDirs, dataDirs } = getRuntimeConfig();
	const descriptors = await collectDataLinkingProblemDescriptors(
		linkDirs ?? [],
		dataDirs ?? [],
	);
	return descriptors.map(buildPathProblem);
}
