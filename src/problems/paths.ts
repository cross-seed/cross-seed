import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { verifyDir } from "../utils.js";
import { stat } from "fs/promises";
import { constants } from "fs";
import { testLinking } from "../action.js";
import { Label, logger } from "../logger.js";

type PathIssue =
	| "missing"
	| "unreadable"
	| "unwritable"
	| "cross-platform-linking"
	| "linking-failed";

interface PathProblemDescriptor {
	category: "torrentDir" | "outputDir" | "injectDir" | "linkDirs" | "dataDirs";
	name: string;
	path: string;
	issue: PathIssue;
	message: string;
	severity: Problem["severity"];
}

function buildProblem(descriptor: PathProblemDescriptor): Problem {
	const { category, name, path, issue, message, severity } = descriptor;
	return {
		id: `path:${category}:${issue}:${path}`,
		severity,
		summary: `${name}: ${message}`,
		details: `Path: ${path}`,
		metadata: {
			category,
			path,
			issue,
		},
	};
}

async function diagnoseDir(
	path: string,
	name: string,
	category: PathProblemDescriptor["category"],
	options: { read?: boolean; write?: boolean },
): Promise<PathProblemDescriptor | null> {
	const mode =
		(options.read ? constants.R_OK : 0) |
		(options.write ? constants.W_OK : 0);
	const exists = await verifyDir(path, name, mode);

	if (exists) {
		return null;
	}

	try {
		await stat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				category,
				name,
				path,
				issue: "missing",
				message: "Directory does not exist.",
				severity: "error",
			};
		}
	}

	return {
		category,
		name,
		path,
		issue: options.write ? "unwritable" : "unreadable",
		message: options.write
			? "cross-seed cannot write to this directory."
			: "cross-seed cannot read from this directory.",
		severity: "error",
	};
}

async function checkLinking(
	linkDirs: string[],
	dataDirs: string[],
): Promise<PathProblemDescriptor[]> {
	const problems: PathProblemDescriptor[] = [];
	if (!linkDirs.length || !dataDirs.length) return problems;

	const linkDirStats = await Promise.all(
		linkDirs.map(async (dir, index) => {
			const descriptor = await diagnoseDir(
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
		const descriptor = await diagnoseDir(
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
					name: `linkDir`,
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
					name: `linkDir`,
					path: matchingLinkDir.path,
					issue: "linking-failed",
					message: "Linking test failed. Check filesystem permissions and mounts.",
					severity: "warning",
				});
			}
		} catch (error) {
			logger.debug({
				label: Label.INJECT,
				message: error,
			});
			problems.push({
				category: "linkDirs",
				name: `linkDir`,
				path: dataDir,
				issue: "linking-failed",
				message: "Linking test threw an error. See logs for details.",
				severity: "error",
			});
		}
	}

	return problems;
}

export async function collectPathProblems(): Promise<Problem[]> {
	const { torrentDir, outputDir, injectDir, linkDirs, dataDirs } =
		getRuntimeConfig();
	const problems: Problem[] = [];

	if (torrentDir) {
		const descriptor = await diagnoseDir(
			torrentDir,
			"torrentDir",
			"torrentDir",
			{ read: true },
		);
		if (descriptor) problems.push(buildProblem(descriptor));
	}

	if (outputDir) {
		const descriptor = await diagnoseDir(
			outputDir,
			"outputDir",
			"outputDir",
			{ read: true, write: true },
		);
		if (descriptor) problems.push(buildProblem(descriptor));
	}

	if (injectDir) {
		const descriptor = await diagnoseDir(
			injectDir,
			"injectDir",
			"injectDir",
			{ read: true, write: true },
		);
		if (descriptor) problems.push(buildProblem(descriptor));
	}

	const linkProblems = await checkLinking(linkDirs ?? [], dataDirs ?? []);
	for (const descriptor of linkProblems) {
		problems.push(buildProblem(descriptor));
	}

	return problems;
}
