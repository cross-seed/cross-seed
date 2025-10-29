import { constants, stat } from "fs/promises";

import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { verifyDir } from "../utils.js";

export type PathIssue =
	| "missing"
	| "not-directory"
	| "unreadable"
	| "unwritable"
	| "cross-platform-linking"
	| "linking-failed";

export type PathProblemCategory =
	| "torrentDir"
	| "outputDir"
	| "injectDir"
	| "linkDirs"
	| "dataDirs";

export interface PathProblemDescriptor {
	category: PathProblemCategory;
	name: string;
	path: string;
	issue: PathIssue;
	message: string;
	severity: Problem["severity"];
}

export function buildPathProblem(descriptor: PathProblemDescriptor): Problem {
	const { category, name, path, issue, message, severity } = descriptor;
	return {
		id: `path:${category}:${issue}:${path}`,
		severity,
		summary: `${name}: ${message}`,
		details: `Path: ${path}`,
		metadata: { category, path, issue },
	};
}

export async function diagnoseDirForProblems(
	path: string,
	name: string,
	category: PathProblemCategory,
	options: { read?: boolean; write?: boolean },
): Promise<PathProblemDescriptor | null> {
	const mode =
		(options.read ? constants.R_OK : 0) |
		(options.write ? constants.W_OK : 0);
	const verification = await verifyDir(path, name, mode);

	if (verification.ok) return null;

	switch (verification.reason) {
		case "missing":
			return {
				category,
				name,
				path,
				issue: "missing",
				message: "Directory does not exist.",
				severity: "error",
			};
		case "not-directory":
			return {
				category,
				name,
				path,
				issue: "not-directory",
				message: "Path is not a directory.",
				severity: "error",
			};
		case "unreadable":
			return {
				category,
				name,
				path,
				issue: "unreadable",
				message: "cross-seed cannot read from this directory.",
				severity: "error",
			};
		case "unwritable":
			return {
				category,
				name,
				path,
				issue: "unwritable",
				message: "cross-seed cannot write to this directory.",
				severity: "error",
			};
		default:
			return {
				category,
				name,
				path,
				issue: "unreadable",
				message: "cross-seed cannot access this directory.",
				severity: "error",
			};
	}
}

export async function collectPathProblems(): Promise<Problem[]> {
	const { torrentDir, outputDir, injectDir } = getRuntimeConfig();
	const descriptors: PathProblemDescriptor[] = [];

	if (torrentDir) {
		const descriptor = await diagnoseDirForProblems(
			torrentDir,
			"torrentDir",
			"torrentDir",
			{ read: true },
		);
		if (descriptor) descriptors.push(descriptor);
	}

	if (outputDir) {
		const descriptor = await diagnoseDirForProblems(
			outputDir,
			"outputDir",
			"outputDir",
			{ read: true, write: true },
		);
		if (descriptor) descriptors.push(descriptor);
	}

	if (injectDir) {
		const descriptor = await diagnoseDirForProblems(
			injectDir,
			"injectDir",
			"injectDir",
			{ read: true, write: true },
		);
		if (descriptor) descriptors.push(descriptor);
	}

	return descriptors.map(buildPathProblem);
}
