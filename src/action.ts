import chalk from "chalk";
import { existsSync, linkSync, mkdirSync, rm, statSync, symlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { getClient } from "./clients/TorrentClient.js";
import {
	Action,
	ActionResult,
	Decision,
	DecisionAllMatch,
	InjectionResult,
	LinkType,
	SaveResult,
	SearcheeSource,
} from "./constants.js";
import { logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	Searchee,
	SearcheeWithInfoHash,
} from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import { getMediaType } from "./utils.js";

function logActionResult(
	result: ActionResult,
	newMeta: Metafile,
	searchee: Searchee,
	tracker: string,
	decision: Decision,
) {
	const metaLog = `${chalk.green.bold(newMeta.name)} ${chalk.dim(`[${newMeta.infoHash.slice(0, 8)}...]`)}`;
	const searcheeLog = searchee.infoHash
		? `${chalk.magenta.bold(searchee.name)} ${chalk.dim(`[${searchee.infoHash.slice(0, 8)}...]`)}`
		: searchee.path
			? chalk.magenta.bold(searchee.path)
			: chalk.magenta.bold(searchee.name);
	const source = searchee.infoHash
		? `${SearcheeSource.TORRENT} (${searcheeLog})`
		: searchee.path
			? `${SearcheeSource.DATA} (${searcheeLog})`
			: `${SearcheeSource.VIRTUAL} (${searcheeLog})`;
	const foundBy = `Found ${metaLog} on ${chalk.bold(tracker)} by`;

	switch (result) {
		case SaveResult.SAVED:
			logger.info(
				`${foundBy} ${chalk.green.bold(decision)} from ${source} - saved`,
			);
			break;
		case InjectionResult.SUCCESS:
			logger.info(
				`${foundBy} ${chalk.green.bold(decision)} from ${source} - injected`,
			);
			break;
		case InjectionResult.ALREADY_EXISTS:
			logger.info(
				`${foundBy} ${chalk.yellow(decision)} from ${source} - exists`,
			);
			break;
		case InjectionResult.TORRENT_NOT_COMPLETE:
			logger.warn(
				`${foundBy} ${chalk.yellow(
					decision,
				)} from ${source} - incomplete torrent, saving...`,
			);
			break;
		case InjectionResult.FAILURE:
		default:
			logger.error(
				`${foundBy} ${chalk.red(
					decision,
				)} from ${source} - failed to inject, saving...`,
			);
			break;
	}
}

/**
 * @return the root of linked files.
 */
function linkExactTree(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string,
): string {
	if (searchee.files.length === 1) {
		return fuzzyLinkOneFile(searchee, newMeta, destinationDir, sourceRoot);
	}
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
	const srcFilePath = statSync(sourceRoot).isFile()
		? sourceRoot
		: join(dirname(sourceRoot), searchee.files[0].path);
	const destFilePath = join(destinationDir, newMeta.files[0].path);
	mkdirSync(dirname(destFilePath), { recursive: true });
	linkFile(srcFilePath, destFilePath);
	return join(destinationDir, newMeta.name);
}

/**
 * @return the root of linked files.
 */
function linkFuzzyTree(
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

function linkVirtualSearchee(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
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
			const srcFilePath = matchedSearcheeFiles[0].path; // Absolute path
			const destFilePath = join(destinationDir, newFile.path);
			mkdirSync(dirname(destFilePath), { recursive: true });
			linkFile(srcFilePath, destFilePath);
		}
	}
	return join(destinationDir, newMeta.name);
}

function unlinkMetafile(meta: Metafile, destinationDir: string) {
	const file = meta.files[0];
	let rootFolder = file.path;
	let parent = dirname(rootFolder);
	while (parent !== ".") {
		rootFolder = parent;
		parent = dirname(rootFolder);
	}
	const fullPath = join(destinationDir, rootFolder);
	if (fullPath === destinationDir) return; // Should never happen
	if (!existsSync(fullPath)) return;
	logger.verbose(`Unlinking ${fullPath}`);
	rm(fullPath, { recursive: true }, () => {});
}

async function linkAllFilesInMetafile(
	searchee: Searchee,
	newMeta: Metafile,
	tracker: string,
	decision: DecisionAllMatch,
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
	let sourceRoot: string | undefined;
	if (searchee.path) {
		if (!existsSync(searchee.path)) {
			logger.error(
				`Linking failed, ${searchee.path} not found. Make sure Docker volume mounts are set up properly.`,
			);
			return resultOfErr("MISSING_DATA");
		}
		const result = await createSearcheeFromPath(searchee.path);
		if (result.isErr()) {
			return resultOfErr("TORRENT_NOT_FOUND");
		}
		const refreshedSearchee = result.unwrapOrThrow();
		if (searchee.length !== refreshedSearchee.length) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		sourceRoot = searchee.path;
	} else if (searchee.infoHash) {
		const downloadDirResult = await getClient().getDownloadDir(
			searchee as SearcheeWithInfoHash,
			true,
		);
		if (downloadDirResult.isErr()) {
			return downloadDirResult.mapErr((e) =>
				e === "NOT_FOUND" || e === "UNKNOWN_ERROR"
					? "TORRENT_NOT_FOUND"
					: e,
			);
		}
		sourceRoot = join(
			downloadDirResult.unwrapOrThrow(),
			searchee.files.length === 1
				? searchee.files[0].path
				: searchee.name,
		);
		if (!existsSync(sourceRoot)) {
			logger.error(
				`Linking failed, ${sourceRoot} not found. Make sure Docker volume mounts are set up properly.`,
			);
			return resultOfErr("MISSING_DATA");
		}
	} else {
		for (const file of searchee.files) {
			if (!existsSync(file.path)) {
				logger.error(
					`Linking failed, ${file.path} not found. Make sure Docker volume mounts are set up properly.`,
				);
				return resultOfErr("MISSING_DATA");
			}
			if (file.length !== statSync(file.path).size) {
				return resultOfErr("TORRENT_NOT_COMPLETE");
			}
		}
	}

	if (!sourceRoot) {
		return resultOf(linkVirtualSearchee(searchee, newMeta, fullLinkDir));
	} else if (decision === Decision.MATCH) {
		return resultOf(
			linkExactTree(searchee, newMeta, fullLinkDir, sourceRoot),
		);
	} else {
		return resultOf(
			linkFuzzyTree(searchee, newMeta, fullLinkDir, sourceRoot),
		);
	}
}

export async function performAction(
	newMeta: Metafile,
	decision: DecisionAllMatch,
	searchee: Searchee,
	tracker: string,
	unlinkOk = true,
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();

	if (action === Action.SAVE) {
		await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
		logActionResult(SaveResult.SAVED, newMeta, searchee, tracker, decision);
		return SaveResult.SAVED;
	}

	let destinationDir: string | undefined;
	let wasLinked = false;

	if (linkDir) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			newMeta,
			tracker,
			decision,
		);
		if (linkedFilesRootResult.isOk()) {
			destinationDir = dirname(linkedFilesRootResult.unwrapOrThrow());
			wasLinked = true;
		} else if (
			decision === Decision.MATCH &&
			(searchee.path || searchee.infoHash) &&
			linkedFilesRootResult.unwrapErrOrThrow() === "MISSING_DATA"
		) {
			logger.warn("Falling back to non-linking.");
			if (searchee.path) {
				destinationDir = dirname(searchee.path);
			}
		} else {
			const result = linkedFilesRootResult.unwrapErrOrThrow();
			logger.error(`Failed to link files for ${newMeta.name}: ${result}`);
			const injectionResult =
				result === "TORRENT_NOT_COMPLETE"
					? InjectionResult.TORRENT_NOT_COMPLETE
					: InjectionResult.FAILURE;
			logActionResult(
				injectionResult,
				newMeta,
				searchee,
				tracker,
				decision,
			);
			await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
			return injectionResult;
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

	logActionResult(result, newMeta, searchee, tracker, decision);
	if (
		[
			InjectionResult.FAILURE,
			InjectionResult.TORRENT_NOT_COMPLETE,
		].includes(result)
	) {
		await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
		if (unlinkOk && wasLinked && destinationDir) {
			unlinkMetafile(newMeta, destinationDir);
		}
	} else if (
		result === InjectionResult.SUCCESS &&
		decision === Decision.MATCH_PARTIAL
	) {
		// For an easy re-injection user workflow when multiple MATCH_PARTIAL
		await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
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
