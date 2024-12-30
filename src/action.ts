import chalk from "chalk";
import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { getClient, shouldRecheck } from "./clients/TorrentClient.js";
import {
	Action,
	ActionResult,
	ALL_EXTENSIONS,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	LinkType,
	SaveResult,
} from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { AssessmentWithTracker } from "./pipeline.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createSearcheeFromPath,
	getAbsoluteFilePath,
	getSearcheeSource,
	Searchee,
	SearcheeVirtual,
	SearcheeWithInfoHash,
	SearcheeWithLabel,
} from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import {
	findAFileWithExt,
	getLinkDir,
	getLinkDirVirtual,
	getLogString,
	getMediaType,
} from "./utils.js";

interface LinkResult {
	contentPath: string;
	alreadyExisted: boolean;
	linkedNewFiles: boolean;
}

function logActionResult(
	result: ActionResult,
	newMeta: Metafile,
	searchee: SearcheeWithLabel,
	tracker: string,
	decision: Decision,
) {
	const metaLog = getLogString(newMeta, chalk.green.bold);
	const searcheeLog = getLogString(searchee, chalk.magenta.bold);
	const source = `${getSearcheeSource(searchee)} (${searcheeLog})`;
	const foundBy = `Found ${metaLog} on ${chalk.bold(tracker)} by`;

	let infoOrVerbose = logger.info;
	let warnOrVerbose = logger.warn;
	if (searchee.label === Label.INJECT) {
		infoOrVerbose = logger.verbose;
		warnOrVerbose = logger.verbose;
	}
	switch (result) {
		case SaveResult.SAVED:
			infoOrVerbose({
				label: searchee.label,
				message: `${foundBy} ${chalk.green.bold(decision)} from ${source} - saved`,
			});
			break;
		case InjectionResult.SUCCESS:
			infoOrVerbose({
				label: searchee.label,
				message: `${foundBy} ${chalk.green.bold(decision)} from ${source} - injected`,
			});
			break;
		case InjectionResult.ALREADY_EXISTS:
			infoOrVerbose({
				label: searchee.label,
				message: `${foundBy} ${chalk.yellow(decision)} from ${source} - exists`,
			});
			break;
		case InjectionResult.TORRENT_NOT_COMPLETE:
			warnOrVerbose({
				label: searchee.label,
				message: `${foundBy} ${chalk.yellow(
					decision,
				)} from ${source} - incomplete torrent, saving...`,
			});
			break;
		case InjectionResult.FAILURE:
		default:
			logger.error({
				label: searchee.label,
				message: `${foundBy} ${chalk.red(
					decision,
				)} from ${source} - failed to inject, saving...`,
			});
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
	options: { ignoreMissing: boolean },
): LinkResult {
	let alreadyExisted = false;
	let linkedNewFiles = false;
	for (const newFile of newMeta.files) {
		const srcFilePath = getAbsoluteFilePath(sourceRoot, newFile.path);
		const destFilePath = join(destinationDir, newFile.path);
		if (existsSync(destFilePath)) {
			alreadyExisted = true;
			continue;
		}
		if (options.ignoreMissing && !existsSync(srcFilePath)) continue;
		mkdirSync(dirname(destFilePath), { recursive: true });
		if (linkFile(srcFilePath, destFilePath)) {
			linkedNewFiles = true;
		}
	}
	const contentPath = join(destinationDir, newMeta.name);
	return { contentPath, alreadyExisted, linkedNewFiles };
}

/**
 * @return the root of linked files.
 */
function linkFuzzyTree(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceRoot: string,
	options: { ignoreMissing: boolean },
): LinkResult {
	let alreadyExisted = false;
	let linkedNewFiles = false;
	const availableFiles = searchee.files.slice();
	for (const newFile of newMeta.files) {
		let matchedSearcheeFiles = availableFiles.filter(
			(searcheeFile) => searcheeFile.length === newFile.length,
		);
		if (matchedSearcheeFiles.length > 1) {
			matchedSearcheeFiles = matchedSearcheeFiles.filter(
				(searcheeFile) => searcheeFile.name === newFile.name,
			);
		}
		if (matchedSearcheeFiles.length) {
			const srcFilePath = getAbsoluteFilePath(
				sourceRoot,
				matchedSearcheeFiles[0].path,
			);
			const destFilePath = join(destinationDir, newFile.path);
			const index = availableFiles.indexOf(matchedSearcheeFiles[0]);
			availableFiles.splice(index, 1);
			if (existsSync(destFilePath)) {
				alreadyExisted = true;
				continue;
			}
			if (options.ignoreMissing && !existsSync(srcFilePath)) continue;
			mkdirSync(dirname(destFilePath), { recursive: true });
			if (linkFile(srcFilePath, destFilePath)) {
				linkedNewFiles = true;
			}
		}
	}
	const contentPath = join(destinationDir, newMeta.name);
	return { contentPath, alreadyExisted, linkedNewFiles };
}

function linkVirtualSearchee(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	options: { ignoreMissing: boolean },
): LinkResult {
	let alreadyExisted = false;
	let linkedNewFiles = false;
	const availableFiles = searchee.files.slice();
	for (const newFile of newMeta.files) {
		let matchedSearcheeFiles = availableFiles.filter(
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
			const index = availableFiles.indexOf(matchedSearcheeFiles[0]);
			availableFiles.splice(index, 1);
			if (existsSync(destFilePath)) {
				alreadyExisted = true;
				continue;
			}
			if (options.ignoreMissing && !existsSync(srcFilePath)) continue;
			mkdirSync(dirname(destFilePath), { recursive: true });
			if (linkFile(srcFilePath, destFilePath)) {
				linkedNewFiles = true;
			}
		}
	}
	const contentPath = join(destinationDir, newMeta.name);
	return { contentPath, alreadyExisted, linkedNewFiles };
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
	if (!existsSync(fullPath)) return;
	if (!fullPath.startsWith(destinationDir)) return; // assert: fullPath is within destinationDir
	if (statSync(fullPath).ino === statSync(destinationDir).ino) return; // assert: fullPath is not destinationDir
	logger.verbose(`Unlinking ${fullPath}`);
	rmSync(fullPath, { recursive: true });
}

export async function linkAllFilesInMetafile(
	searchee: Searchee,
	newMeta: Metafile,
	tracker: string,
	decision: DecisionAnyMatch,
	options: { onlyCompleted: boolean },
): Promise<
	Result<
		LinkResult,
		| "MISSING_DATA"
		| "TORRENT_NOT_FOUND"
		| "TORRENT_NOT_COMPLETE"
		| "UNKNOWN_ERROR"
	>
> {
	const { flatLinking } = getRuntimeConfig();

	let sourceRoot: string | undefined;
	if (searchee.infoHash) {
		const downloadDirResult = await getClient()!.getDownloadDir(
			searchee as SearcheeWithInfoHash,
			{ onlyCompleted: options.onlyCompleted },
		);
		if (downloadDirResult.isErr()) {
			return downloadDirResult.mapErr((e) =>
				e === "NOT_FOUND" || e === "UNKNOWN_ERROR"
					? "TORRENT_NOT_FOUND"
					: e,
			);
		}
		sourceRoot = join(
			downloadDirResult.unwrap(),
			searchee.files.length === 1
				? searchee.files[0].path
				: searchee.name,
		);
		if (!existsSync(sourceRoot)) {
			logger.error({
				label: searchee.label,
				message: `Linking failed, ${sourceRoot} not found. Make sure Docker volume mounts are set up properly.`,
			});
			return resultOfErr("MISSING_DATA");
		}
	} else if (searchee.path) {
		if (!existsSync(searchee.path)) {
			logger.error({
				label: searchee.label,
				message: `Linking failed, ${searchee.path} not found. Make sure Docker volume mounts are set up properly.`,
			});
			return resultOfErr("MISSING_DATA");
		}
		const result = await createSearcheeFromPath(searchee.path);
		if (result.isErr()) {
			return resultOfErr("TORRENT_NOT_FOUND");
		}
		const refreshedSearchee = result.unwrap();
		if (
			options.onlyCompleted &&
			(searchee.mtimeMs !== refreshedSearchee.mtimeMs ||
				searchee.length !== refreshedSearchee.length)
		) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		sourceRoot = searchee.path;
	} else {
		for (const file of searchee.files) {
			if (!existsSync(file.path)) {
				logger.error(
					`Linking failed, ${file.path} not found. Make sure Docker volume mounts are set up properly.`,
				);
				return resultOfErr("MISSING_DATA");
			}
			if (options.onlyCompleted) {
				const f = statSync(file.path);
				if (searchee.mtimeMs! < f.mtimeMs || file.length !== f.size) {
					return resultOfErr("TORRENT_NOT_COMPLETE");
				}
			}
		}
	}

	const clientSavePathRes = await getClient()!.getDownloadDir(newMeta, {
		onlyCompleted: false,
	});
	let destinationDir: string | null = null;
	if (clientSavePathRes.isOk()) {
		destinationDir = clientSavePathRes.unwrap();
	} else {
		const linkDir = sourceRoot
			? getLinkDir(sourceRoot)
			: getLinkDirVirtual(searchee as SearcheeVirtual);
		if (!linkDir) return resultOfErr("MISSING_DATA");
		destinationDir = flatLinking ? linkDir : join(linkDir, tracker);
	}

	if (!sourceRoot) {
		return resultOf(
			linkVirtualSearchee(searchee, newMeta, destinationDir, {
				ignoreMissing: !options.onlyCompleted,
			}),
		);
	} else if (decision === Decision.MATCH) {
		return resultOf(
			linkExactTree(newMeta, destinationDir, sourceRoot, {
				ignoreMissing: !options.onlyCompleted,
			}),
		);
	} else {
		return resultOf(
			linkFuzzyTree(searchee, newMeta, destinationDir, sourceRoot, {
				ignoreMissing: !options.onlyCompleted,
			}),
		);
	}
}

export async function performAction(
	newMeta: Metafile,
	decision: DecisionAnyMatch,
	searchee: SearcheeWithLabel,
	tracker: string,
): Promise<{ actionResult: ActionResult; linkedNewFiles: boolean }> {
	const { action, linkDirs } = getRuntimeConfig();

	if (action === Action.SAVE) {
		await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
		logActionResult(SaveResult.SAVED, newMeta, searchee, tracker, decision);
		return { actionResult: SaveResult.SAVED, linkedNewFiles: false };
	}

	let destinationDir: string | undefined;
	let unlinkOk = false;
	let linkedNewFiles = false;

	if (linkDirs.length) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			newMeta,
			tracker,
			decision,
			{ onlyCompleted: true },
		);
		if (linkedFilesRootResult.isOk()) {
			const linkResult = linkedFilesRootResult.unwrap();
			destinationDir = dirname(linkResult.contentPath);
			unlinkOk = !linkResult.alreadyExisted;
			linkedNewFiles = linkResult.linkedNewFiles;
		} else {
			const result = linkedFilesRootResult.unwrapErr();
			const warnOrVerbose =
				searchee.label !== Label.INJECT ? logger.warn : logger.verbose;
			warnOrVerbose({
				label: searchee.label,
				message: `Failed to link files for ${getLogString(newMeta)}: ${result}`,
			});
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
			return { actionResult: injectionResult, linkedNewFiles };
		}
	} else if (searchee.path) {
		destinationDir = dirname(searchee.path);
	}
	const result = await getClient()!.inject(
		newMeta,
		searchee,
		decision,
		destinationDir,
	);

	logActionResult(result, newMeta, searchee, tracker, decision);
	if (result === InjectionResult.SUCCESS) {
		// cross-seed may need to process these with the inject job
		if (shouldRecheck(searchee, decision) || !searchee.infoHash) {
			await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
		}
	} else if (result !== InjectionResult.ALREADY_EXISTS) {
		await saveTorrentFile(tracker, getMediaType(searchee), newMeta);
		if (unlinkOk && destinationDir) {
			unlinkMetafile(newMeta, destinationDir);
		}
	}
	return { actionResult: result, linkedNewFiles };
}

export async function performActions(
	searchee: SearcheeWithLabel,
	matches: AssessmentWithTracker[],
) {
	const results: ActionResult[] = [];
	for (const { tracker, assessment } of matches) {
		const { actionResult } = await performAction(
			assessment.metafile!,
			assessment.decision as DecisionAnyMatch,
			searchee,
			tracker,
		);
		results.push(actionResult);
		if (actionResult === InjectionResult.TORRENT_NOT_COMPLETE) break;
	}
	return results;
}

function linkFile(oldPath: string, newPath: string): boolean {
	const { linkType } = getRuntimeConfig();
	try {
		const ogFileResolvedPath = unwrapSymlinks(oldPath);

		if (linkType === LinkType.HARDLINK) {
			linkSync(ogFileResolvedPath, newPath);
		} else {
			// we need to resolve because symlinks are resolved outside
			// the context of cross-seed's working directory
			symlinkSync(ogFileResolvedPath, resolve(newPath));
		}
		return true;
	} catch (e) {
		if (e.code === "EEXIST") return false;
		throw e;
	}
}

/**
 * Recursively resolves symlinks to the original file. Differs from realpath
 * in that it will not resolve directory symlinks in the middle of the path.
 * @param path
 */
function unwrapSymlinks(path: string): string {
	for (let i = 0; i < 16; i++) {
		if (!lstatSync(path).isSymbolicLink()) {
			return path;
		}
		path = resolve(dirname(path), readlinkSync(path));
	}
	throw new Error(`too many levels of symbolic links at ${path}`);
}

/**
 * Tests if srcDir supports linkType.
 * @param srcDir The directory to link from
 */
export function testLinking(srcDir: string): void {
	const { linkType } = getRuntimeConfig();
	try {
		const linkDir = getLinkDir(srcDir);
		if (!linkDir) throw new Error(`No valid linkDir found for ${srcDir}`);
		const srcFile = findAFileWithExt(srcDir, ALL_EXTENSIONS);
		if (!srcFile) return;
		const testPath = join(linkDir, "cross-seed.test");
		linkFile(srcFile, testPath);
		rmSync(testPath);
	} catch (e) {
		logger.error(e);
		throw new CrossSeedError(
			`Failed to create a test ${linkType} in any linkDirs from ${srcDir}. Ensure that ${linkType} is supported between these paths (hardlink requires same drive, partition, and volume).`,
		);
	}
}
