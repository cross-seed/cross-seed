import chalk from "chalk";
import { existsSync, linkSync, mkdirSync, statSync, symlinkSync } from "fs";
import { dirname, join, resolve } from "path";
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
import { Searchee, hasVideo } from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import { getTag } from "./utils.js";

function logInjectionResult(
	result: InjectionResult,
	tracker: string,
	name: string,
	decision: Decision,
) {
	const styledName = chalk.green.bold(name);
	const styledTracker = chalk.bold(tracker);
	switch (result) {
		case InjectionResult.SUCCESS:
			logger.info(
				`Found ${styledName} on ${styledTracker} by ${decision} - injected`,
			);
			break;
		case InjectionResult.ALREADY_EXISTS:
			logger.info(
				`Found ${styledName} on ${styledTracker} by ${decision} - exists`,
			);
			break;
		case InjectionResult.TORRENT_NOT_COMPLETE:
			logger.warn(
				`Found ${styledName} on ${styledTracker} by ${decision} - skipping incomplete torrent`,
			);
			break;
		case InjectionResult.FAILURE:
		default:
			logger.error(
				`Found ${styledName} on ${styledTracker} by ${decision} - failed to inject, saving instead`,
			);
			break;
	}
}

/**
 * @return the root of linked files.
 */
function linkExactTree(
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string,
): string {
	for (const newFile of newMeta.files) {
		const srcFilePath = join(dirname(sourceRoot), newFile.path);
		const destFilePath = join(destinationDir, newFile.path);
		mkdirSync(dirname(destFilePath), { recursive: true });
		linkFile(srcFilePath, destFilePath);
	}
	return join(destinationDir, newMeta.name);
}

/**
 * @return the root of linked file.
 */
function fuzzyLinkOneFile(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string,
): string {
	const srcFilePath = join(dirname(sourceRoot), searchee.files[0].path);
	const destFilePath = join(destinationDir, newMeta.files[0].path);
	mkdirSync(dirname(destFilePath), { recursive: true });
	linkFile(srcFilePath, destFilePath);
	return join(destinationDir, newMeta.name);
}

/**
 * @return the root of linked files.
 */
function fuzzyLinkPartial(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string,
): string {
	for (const newFile of newMeta.files) {
		let matchedSearcheeFiles = searchee.files.filter(
			(searcheeFile) => searcheeFile.length === newFile.length,
		);
		if (matchedSearcheeFiles.length > 1) {
			matchedSearcheeFiles = matchedSearcheeFiles.filter(
				(searcheeFile) => searcheeFile.name === newFile.name,
			);
		}
		if (matchedSearcheeFiles.length) {
			const srcFilePath = statSync(sourceRoot).isFile()
				? sourceRoot
				: join(dirname(sourceRoot), matchedSearcheeFiles[0].path);
			const destFilePath = join(destinationDir, newFile.path);
			mkdirSync(dirname(destFilePath), { recursive: true });
			linkFile(srcFilePath, destFilePath);
		}
	}
	return join(destinationDir, newMeta.name);
}

async function linkAllFilesInMetafile(
	searchee: Searchee,
	newMeta: Metafile,
	tracker: string,
	decision:
		| Decision.MATCH
		| Decision.MATCH_SIZE_ONLY
		| Decision.MATCH_PARTIAL,
): Promise<
	Result<
		string,
		| "MISSING_DATA"
		| "TORRENT_NOT_FOUND"
		| "TORRENT_NOT_COMPLETE"
		| "UNKNOWN_ERROR"
	>
> {
	const { linkDir, flatLinking } = getRuntimeConfig();
	const fullLinkDir = flatLinking ? linkDir : join(linkDir, tracker);
	let sourceRoot: string;
	if (searchee.path) {
		sourceRoot = searchee.path;
	} else {
		const downloadDirResult = await getClient().getDownloadDir(searchee);
		if (downloadDirResult.isErr()) {
			return downloadDirResult.mapErr((e) =>
				e === "NOT_FOUND" ? "TORRENT_NOT_FOUND" : e,
			);
		}
		sourceRoot = join(
			downloadDirResult.unwrapOrThrow(),
			searchee.files.length === 1
				? searchee.files[0].path
				: searchee.name,
		);
	}

	if (!existsSync(sourceRoot)) {
		logger.error(
			`Linking failed, ${sourceRoot} not found. Make sure Docker volume mounts are set up properly.`,
		);
		return resultOfErr("MISSING_DATA");
	}

	if (decision === Decision.MATCH) {
		return resultOf(linkExactTree(newMeta, fullLinkDir, sourceRoot));
	} else if (decision === Decision.MATCH_SIZE_ONLY) {
		return resultOf(
			fuzzyLinkOneFile(searchee, newMeta, fullLinkDir, sourceRoot),
		);
	} else {
		return resultOf(
			fuzzyLinkPartial(searchee, newMeta, fullLinkDir, sourceRoot),
		);
	}
}

export async function performAction(
	newMeta: Metafile,
	decision:
		| Decision.MATCH
		| Decision.MATCH_SIZE_ONLY
		| Decision.MATCH_PARTIAL,
	searchee: Searchee,
	tracker: string,
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();
	const isVideo = hasVideo(searchee);

	if (action === Action.SAVE) {
		await saveTorrentFile(tracker, getTag(searchee.name, isVideo), newMeta);
		const styledName = chalk.green.bold(newMeta.name);
		const styledTracker = chalk.bold(tracker);
		logger.info(
			`Found ${styledName} on ${styledTracker} by ${decision} - saved`,
		);
		return SaveResult.SAVED;
	}

	let destinationDir: string | undefined;

	if (linkDir) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			newMeta,
			tracker,
			decision,
		);
		if (linkedFilesRootResult.isOk()) {
			destinationDir = dirname(linkedFilesRootResult.unwrapOrThrow());
		} else if (
			decision === Decision.MATCH &&
			linkedFilesRootResult.unwrapErrOrThrow() === "MISSING_DATA"
		) {
			logger.warn("Falling back to non-linking.");
			if (searchee.path) {
				destinationDir = dirname(searchee.path);
			}
		} else {
			logInjectionResult(
				InjectionResult.FAILURE,
				tracker,
				newMeta.name,
				decision,
			);
			await saveTorrentFile(
				tracker,
				getTag(searchee.name, isVideo),
				newMeta,
			);
			return InjectionResult.FAILURE;
		}
	} else if (searchee.path) {
		// should be a MATCH, as risky requires a linkDir to be set
		destinationDir = dirname(searchee.path);
	}
	const result = await getClient().inject(
		newMeta,
		searchee,
		decision,
		destinationDir,
	);

	logInjectionResult(result, tracker, newMeta.name, decision);
	if (result === InjectionResult.FAILURE) {
		await saveTorrentFile(tracker, getTag(searchee.name, isVideo), newMeta);
	}
	return result;
}

export async function performActions(searchee, matches) {
	const results: ActionResult[] = [];
	for (const { tracker, assessment } of matches) {
		const result = await performAction(
			assessment.metafile,
			assessment.decision,
			searchee,
			tracker,
		);
		results.push(result);
		if (result === InjectionResult.TORRENT_NOT_COMPLETE) break;
	}
	return results;
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
