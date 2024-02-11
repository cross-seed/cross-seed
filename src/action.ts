import chalk from "chalk";
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	statSync,
	symlinkSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { getClient } from "./clients/TorrentClient.js";
import {
	Action,
	ActionResult,
	Decision,
	InjectionResult,
	LinkType,
	SaveResult,
} from "./constants.js";
import { logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import { getTag } from "./utils.js";

function logInjectionResult(
	result: InjectionResult,
	tracker: string,
	name: string
) {
	const styledName = chalk.green.bold(name);
	const styledTracker = chalk.bold(tracker);
	switch (result) {
		case InjectionResult.SUCCESS:
			logger.info(`Found ${styledName} on ${styledTracker} - injected`);
			break;
		case InjectionResult.ALREADY_EXISTS:
			logger.info(`Found ${styledName} on ${styledTracker} - exists`);
			break;
		case InjectionResult.TORRENT_NOT_COMPLETE:
			logger.warn(
				`Found ${styledName} on ${styledTracker} - skipping incomplete torrent`
			);
			break;
		case InjectionResult.FAILURE:
		default:
			logger.error(
				`Found ${styledName} on ${styledTracker} - failed to inject, saving instead`
			);
			break;
	}
}

/**
 * this may not work with subfolder content layout
 * @return the root of linked file. most likely "destinationDir/name". Not necessarily a file, it can be a directory
 */
function fuzzyLinkOneFile(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string
): string {
	const srcFilePath = join(
		sourceRoot,
		relative(searchee.name, searchee.files[0].path)
	);
	const destFilePath = join(destinationDir, newMeta.files[0].path);
	mkdirSync(dirname(destFilePath), { recursive: true });
	linkFile(srcFilePath, destFilePath);
	return join(destinationDir, newMeta.name);
}

async function linkAllFilesInMetafile(
	searchee: Searchee,
	newMeta: Metafile,
	tracker: string,
	decision: Decision.MATCH | Decision.MATCH_SIZE_ONLY
): Promise<
	Result<
		string,
		| "MISSING_DATA"
		| "TORRENT_NOT_FOUND"
		| "TORRENT_NOT_COMPLETE"
		| "UNKNOWN_ERROR"
	>
> {
	const { linkDir, legacyLinking } = getRuntimeConfig();
	const fullLinkDir = legacyLinking ? linkDir : join(linkDir, tracker);
	let sourceRoot: string;
	if (searchee.path) {
		sourceRoot = searchee.path;
	} else {
		const downloadDirResult = await getClient().getDownloadDir(searchee);
		if (downloadDirResult.isErr()) {
			return downloadDirResult.mapErr((e) =>
				e === "NOT_FOUND" ? "TORRENT_NOT_FOUND" : e
			);
		}
		sourceRoot = join(downloadDirResult.unwrapOrThrow(), searchee.name);
	}

	if (!existsSync(sourceRoot)) {
		logger.error(`Linking failed, ${sourceRoot} not found`);
		return resultOfErr("MISSING_DATA");
	}

	if (decision === Decision.MATCH) {
		linkExactTree(sourceRoot, fullLinkDir);
	}
	return resultOf(
		fuzzyLinkOneFile(searchee, newMeta, fullLinkDir, sourceRoot)
	);
}

export async function performAction(
	newMeta: Metafile,
	decision: Decision.MATCH | Decision.MATCH_SIZE_ONLY,
	searchee: Searchee,
	tracker: string
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();
	let linkedFilesRoot: string | undefined;

	if (linkDir) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			newMeta,
			tracker,
			decision
		);
		if (linkedFilesRootResult.isErr()) {
			// TODO
			return InjectionResult.FAILURE;
		}
		linkedFilesRoot = linkedFilesRootResult.unwrapOrThrow();
	}

	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
			linkedFilesRoot
		);
		logInjectionResult(result, tracker, newMeta.name);
		if (result === InjectionResult.FAILURE) {
			saveTorrentFile(tracker, getTag(searchee.name), newMeta);
		}
		return result;
	} else {
		saveTorrentFile(tracker, getTag(searchee.name), newMeta);
		const styledName = chalk.green.bold(newMeta.name);
		const styledTracker = chalk.bold(tracker);
		logger.info(`Found ${styledName} on ${styledTracker} - saved`);
		return SaveResult.SAVED;
	}
}

export async function performActions(searchee, matches) {
	const results: ActionResult[] = [];
	for (const { tracker, assessment } of matches) {
		const result = await performAction(
			assessment.metafile,
			assessment.decision,
			searchee,
			tracker
		);
		results.push(result);
		if (result === InjectionResult.TORRENT_NOT_COMPLETE) break;
	}
	return results;
}

/**
 * @return the root of linked files.
 */

function linkExactTree(oldPath: string, dest: string): string {
	const newPath = join(dest, basename(oldPath));
	if (statSync(oldPath).isFile()) {
		linkFile(oldPath, newPath);
	} else {
		mkdirSync(newPath, { recursive: true });
		for (const dirent of readdirSync(oldPath)) {
			linkExactTree(join(oldPath, dirent), newPath);
		}
	}
	return newPath;
}

function linkFile(oldPath: string, newPath: string) {
	const { linkType } = getRuntimeConfig();
	try {
		if (linkType === LinkType.HARDLINK) {
			linkSync(oldPath, newPath);
		} else {
			// we need to resolve because symlinks are resolved outside
			// the context of cross-seed's working directory
			symlinkSync(oldPath, resolve(newPath));
		}
	} catch (e) {
		if (e.code === "EEXIST") return;
		throw e;
	}
}
