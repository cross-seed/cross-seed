import chalk from "chalk";
import fs from "fs";
import { dirname, join, resolve } from "path";
import {
	getClients,
	shouldRecheck,
	TorrentClient,
} from "./clients/TorrentClient.js";
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
	getRoot,
	getRootFolder,
	getSearcheeSource,
	Searchee,
	SearcheeVirtual,
	SearcheeWithInfoHash,
	SearcheeWithLabel,
} from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import {
	findAFileWithExt,
	formatAsList,
	getLogString,
	getMediaType,
	Mutex,
	withMutex,
} from "./utils.js";

const srcTestName = "test.cross-seed";
const linkTestName = "cross-seed.test";

type ActionReturn =
	| {
			client: TorrentClient;
			actionResult:
				| InjectionResult.SUCCESS
				| InjectionResult.ALREADY_EXISTS;
			linkedNewFiles: boolean;
	  }
	| {
			client?: TorrentClient;
			actionResult: InjectionResult.TORRENT_NOT_COMPLETE;
			linkedNewFiles: boolean;
	  }
	| { actionResult: InjectionResult.FAILURE; linkedNewFiles: boolean }
	| { actionResult: SaveResult.SAVED };

interface LinkResult {
	alreadyExisted: boolean;
	linkedNewFiles: boolean;
}

function linkAllFilesInMetafile(
	searchee: Searchee,
	newMeta: Metafile,
	decision: DecisionAnyMatch,
	destinationDir: string,
	options: { savePath?: string; ignoreMissing: boolean },
): Result<LinkResult, Error> {
	const availableFiles = searchee.files.slice();
	const paths =
		decision === Decision.MATCH && options.savePath
			? newMeta.files.map((file) => [
					join(options.savePath!, file.path),
					join(destinationDir, file.path),
				])
			: newMeta.files.reduce<string[][]>((acc, newFile) => {
					let matchedSearcheeFiles = availableFiles.filter(
						(searcheeFile) =>
							searcheeFile.length === newFile.length,
					);
					if (matchedSearcheeFiles.length > 1) {
						matchedSearcheeFiles = matchedSearcheeFiles.filter(
							(searcheeFile) =>
								searcheeFile.name === newFile.name,
						);
					}
					if (!matchedSearcheeFiles.length) return acc;
					const index = availableFiles.indexOf(
						matchedSearcheeFiles[0],
					);
					availableFiles.splice(index, 1);
					const srcFilePath = options.savePath
						? join(options.savePath, matchedSearcheeFiles[0].path)
						: matchedSearcheeFiles[0].path; // Absolute path
					acc.push([srcFilePath, join(destinationDir, newFile.path)]);
					return acc;
				}, []);
	let alreadyExisted = false;
	let linkedNewFiles = false;
	try {
		const validPaths = paths.filter(([srcFilePath, destFilePath]) => {
			if (fs.existsSync(destFilePath)) {
				alreadyExisted = true;
				return false;
			}
			if (fs.existsSync(srcFilePath)) return true;
			if (options.ignoreMissing) return false;
			throw new Error(`Linking failed, ${srcFilePath} not found.`);
		});
		for (const [srcFilePath, destFilePath] of validPaths) {
			const destFileParentPath = dirname(destFilePath);
			if (!fs.existsSync(destFileParentPath)) {
				fs.mkdirSync(destFileParentPath, { recursive: true });
			}
			if (linkFile(srcFilePath, destFilePath)) {
				linkedNewFiles = true;
			}
		}
	} catch (e) {
		return resultOfErr(e);
	}
	return resultOf({ alreadyExisted, linkedNewFiles });
}

function unlinkMetafile(meta: Metafile, destinationDir: string) {
	const destinationDirIno = fs.statSync(destinationDir).ino;
	const roots = meta.files.map((file) => join(destinationDir, getRoot(file)));
	for (const root of roots) {
		if (!fs.existsSync(root)) continue;
		if (!root.startsWith(destinationDir)) continue; // assert: root is within destinationDir
		if (resolve(root) === resolve(destinationDir)) continue; // assert: root is not destinationDir
		if (fs.statSync(root).ino === destinationDirIno) continue; // assert: root is not destinationDir
		logger.verbose(`Unlinking ${root}`);
		fs.rmSync(root, { recursive: true });
	}
}

async function getSavePath(
	client: TorrentClient | undefined,
	searchee: Searchee,
	options: { onlyCompleted: boolean },
): Promise<
	Result<
		string | undefined,
		"INVALID_DATA" | "TORRENT_NOT_FOUND" | "TORRENT_NOT_COMPLETE"
	>
> {
	if (searchee.path) {
		if (!fs.existsSync(searchee.path)) {
			logger.error({
				label: searchee.label,
				message: `Linking failed, ${searchee.path} not found.`,
			});
			return resultOfErr("INVALID_DATA");
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
		return resultOf(dirname(searchee.path));
	} else if (!searchee.infoHash) {
		for (const file of searchee.files) {
			if (!fs.existsSync(file.path)) {
				logger.error(`Linking failed, ${file.path} not found.`);
				return resultOfErr("INVALID_DATA");
			}
			if (options.onlyCompleted) {
				const f = fs.statSync(file.path);
				if (searchee.mtimeMs! < f.mtimeMs || file.length !== f.size) {
					return resultOfErr("TORRENT_NOT_COMPLETE");
				}
			}
		}
		return resultOf(undefined);
	}
	let savePath: string;
	if (searchee.savePath) {
		const refreshedSearchee = (
			await client!.getClientSearchees({
				newSearcheesOnly: true,
				refresh: [searchee.infoHash],
			})
		).newSearchees.find((s) => s.infoHash === searchee.infoHash);
		if (!refreshedSearchee) return resultOfErr("TORRENT_NOT_FOUND");
		for (const [key, value] of Object.entries(refreshedSearchee)) {
			searchee[key] = value;
		}
		if (
			!(await client!.isTorrentComplete(searchee.infoHash)).orElse(false)
		) {
			return resultOfErr("TORRENT_NOT_COMPLETE");
		}
		savePath = searchee.savePath;
	} else {
		const downloadDirResult = await client!.getDownloadDir(
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
		savePath = downloadDirResult.unwrap();
	}
	const rootFolder = getRootFolder(searchee.files[0]);
	const sourceRootOrSavePath =
		searchee.files.length === 1
			? join(savePath, searchee.files[0].path)
			: rootFolder
				? join(savePath, rootFolder)
				: savePath;
	if (!fs.existsSync(sourceRootOrSavePath)) {
		logger.error({
			label: searchee.label,
			message: `Linking failed, ${sourceRootOrSavePath} not found.`,
		});
		return resultOfErr("INVALID_DATA");
	}
	return resultOf(savePath);
}

async function getClientAndDestinationDir(
	client: TorrentClient | undefined,
	searchee: Searchee,
	savePath: string | undefined,
	newMeta: Metafile,
	tracker: string,
): Promise<{ client: TorrentClient; destinationDir: string } | null> {
	const { flatLinking, linkType } = getRuntimeConfig();
	if (!client) {
		let srcPath: string;
		let srcDev: number;
		try {
			srcPath = !savePath
				? searchee.files.find((f) => fs.existsSync(f.path))!.path
				: join(
						savePath,
						searchee.files.find((f) =>
							fs.existsSync(join(savePath, f.path)),
						)!.path,
					);
			srcDev = fs.statSync(srcPath).dev;
		} catch (e) {
			logger.debug(e);
			return null;
		}
		let error: Error | undefined;
		for (const testClient of getClients()) {
			const torrentSavePaths = new Set(
				(
					await testClient.getAllDownloadDirs({
						metas: [],
						onlyCompleted: false,
					})
				).values(),
			);
			for (const torrentSavePath of torrentSavePaths) {
				try {
					if (srcDev && fs.statSync(torrentSavePath).dev === srcDev) {
						client = testClient;
						break;
					}
					const testPath = join(torrentSavePath, linkTestName);
					linkFile(
						srcPath,
						testPath,
						linkType === LinkType.REFLINK
							? linkType
							: LinkType.HARDLINK,
					);
					fs.rmSync(testPath);
					client = testClient;
					break;
				} catch (e) {
					error = e;
				}
			}
			if (client) break;
		}
		if (!client) {
			logger.debug(error);
			return null;
		}
	}

	let destinationDir: string;
	const clientSavePathRes = await client.getDownloadDir(newMeta, {
		onlyCompleted: false,
	});
	if (clientSavePathRes.isOk()) {
		destinationDir = clientSavePathRes.unwrap();
	} else {
		if (clientSavePathRes.unwrapErr() === "INVALID_DATA") {
			return null;
		}
		const linkDir = savePath
			? getLinkDir(savePath)
			: getLinkDirVirtual(searchee as SearcheeVirtual);
		if (!linkDir) return null;
		destinationDir = flatLinking ? linkDir : join(linkDir, tracker);
	}
	return { client, destinationDir };
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
				)} from ${source} - source is incomplete, saving...`,
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

export async function performAction(
	newMeta: Metafile,
	decision: DecisionAnyMatch,
	searchee: SearcheeWithLabel,
	tracker: string,
): Promise<ActionReturn> {
	return withMutex(
		Mutex.CLIENT_INJECTION,
		async () => {
			return performActionWithoutMutex(
				newMeta,
				decision,
				searchee,
				tracker,
			);
		},
		{ useQueue: true },
	);
}

export async function performActionWithoutMutex(
	newMeta: Metafile,
	decision: DecisionAnyMatch,
	searchee: SearcheeWithLabel,
	tracker: string,
	injectClient?: TorrentClient,
	options = { onlyCompleted: true },
): Promise<ActionReturn> {
	const { action, linkDirs } = getRuntimeConfig();

	if (action === Action.SAVE) {
		logActionResult(SaveResult.SAVED, newMeta, searchee, tracker, decision);
		await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
		return { actionResult: SaveResult.SAVED };
	}

	let savePath: string | undefined;
	let destinationDir: string | undefined;
	let unlinkOk = false;
	let linkedNewFiles = false;
	const warnOrVerbose =
		searchee.label !== Label.INJECT ? logger.warn : logger.verbose;

	const clients = getClients();
	let client =
		clients.length === 1
			? clients[0]
			: clients.find((c) => c.clientHost === searchee.clientHost);
	if (linkDirs.length) {
		const savePathRes = await getSavePath(client, searchee, options);
		if (savePathRes.isErr()) {
			const result = savePathRes.unwrapErr();
			if (result === "TORRENT_NOT_COMPLETE") {
				const actionResult = InjectionResult.TORRENT_NOT_COMPLETE;
				logActionResult(
					actionResult,
					newMeta,
					searchee,
					tracker,
					decision,
				);
				await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
				return { client, actionResult, linkedNewFiles };
			}
			const actionResult = InjectionResult.FAILURE;
			logger.error({
				label: searchee.label,
				message: `Failed to link files for ${getLogString(newMeta)} from ${getLogString(searchee)}: ${result}`,
			});
			logActionResult(actionResult, newMeta, searchee, tracker, decision);
			await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
			return { actionResult, linkedNewFiles };
		}
		savePath = savePathRes.unwrap();
		const res = await getClientAndDestinationDir(
			client,
			searchee,
			savePath,
			newMeta,
			tracker,
		);
		if (res) {
			client = res.client;
			destinationDir = res.destinationDir;
		} else {
			client = undefined;
		}
	}

	if (!client) {
		logger.error({
			label: searchee.label,
			message: `Failed to find a torrent client for ${getLogString(searchee)}`,
		});
		const actionResult = InjectionResult.FAILURE;
		logActionResult(actionResult, newMeta, searchee, tracker, decision);
		await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
		return { actionResult, linkedNewFiles };
	}
	for (const otherClient of clients) {
		if (otherClient.clientHost === client.clientHost) continue;
		if ((await otherClient.isTorrentComplete(newMeta.infoHash)).isErr()) {
			continue;
		}
		warnOrVerbose({
			label: searchee.label,
			message: `Skipping ${getLogString(newMeta)} injection into ${client.clientHost} - already exists in ${otherClient.clientHost}`,
		});
		const actionResult = InjectionResult.FAILURE;
		logActionResult(actionResult, newMeta, searchee, tracker, decision);
		return { actionResult, linkedNewFiles };
	}
	if (injectClient && injectClient.clientHost !== client.clientHost) {
		warnOrVerbose({
			label: searchee.label,
			message: `Skipping ${getLogString(newMeta)} injection into ${client.clientHost} - existing match is using ${injectClient.clientHost}`,
		});
		const actionResult = InjectionResult.FAILURE;
		logActionResult(actionResult, newMeta, searchee, tracker, decision);
		return { actionResult, linkedNewFiles };
	}

	if (linkDirs.length) {
		const res = linkAllFilesInMetafile(
			searchee,
			newMeta,
			decision,
			destinationDir!,
			{ savePath, ignoreMissing: !options.onlyCompleted },
		);
		if (res.isErr()) {
			logger.error({
				label: searchee.label,
				message: `Failed to link files for ${getLogString(newMeta)} from ${getLogString(searchee)}: ${res.unwrapErr().message}`,
			});
			const actionResult = InjectionResult.FAILURE;
			logActionResult(actionResult, newMeta, searchee, tracker, decision);
			await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
			return { actionResult, linkedNewFiles };
		}
		const linkResult = res.unwrap();
		unlinkOk = !linkResult.alreadyExisted;
		linkedNewFiles = linkResult.linkedNewFiles;
	} else if (searchee.path) {
		destinationDir = dirname(searchee.path);
	}

	const actionResult = await client.inject(newMeta, searchee, decision, {
		onlyCompleted: options.onlyCompleted,
		destinationDir,
	});

	logActionResult(actionResult, newMeta, searchee, tracker, decision);
	if (actionResult === InjectionResult.SUCCESS) {
		// cross-seed may need to process these with the inject job
		if (shouldRecheck(searchee, decision) || !searchee.infoHash) {
			await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
		}
	} else if (actionResult !== InjectionResult.ALREADY_EXISTS) {
		await saveTorrentFile(tracker, getMediaType(newMeta), newMeta);
		if (unlinkOk && destinationDir) {
			unlinkMetafile(newMeta, destinationDir);
			linkedNewFiles = false;
		}
	}
	if (actionResult === InjectionResult.FAILURE) {
		return { actionResult, linkedNewFiles };
	}
	return { client, actionResult, linkedNewFiles };
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
	}
	return results;
}

export function getLinkDir(pathStr: string): string | null {
	const { linkDirs, linkType } = getRuntimeConfig();
	const pathStat = fs.statSync(pathStr);
	const pathDev = pathStat.dev; // Windows always returns 0
	if (pathDev) {
		for (const linkDir of linkDirs) {
			if (fs.statSync(linkDir).dev === pathDev) return linkDir;
		}
	}
	let srcFile = pathStat.isFile()
		? pathStr
		: pathStat.isDirectory()
			? findAFileWithExt(pathStr, ALL_EXTENSIONS)
			: null;
	let tempFile: string | undefined;
	if (!srcFile) {
		tempFile = pathStat.isDirectory()
			? join(pathStr, srcTestName)
			: join(dirname(pathStr), srcTestName);
		try {
			fs.writeFileSync(tempFile, "");
			srcFile = tempFile;
		} catch (e) {
			logger.debug(e);
		}
	}
	if (srcFile) {
		for (const linkDir of linkDirs) {
			try {
				const testPath = join(linkDir, linkTestName);
				linkFile(
					srcFile,
					testPath,
					linkType === LinkType.REFLINK
						? linkType
						: LinkType.HARDLINK,
				);
				fs.rmSync(testPath);
				if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
				return linkDir;
			} catch {
				continue;
			}
		}
	}
	if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
	if (linkType !== LinkType.SYMLINK) {
		logger.error(
			`Cannot find any linkDir from linkDirs on the same drive to ${linkType} ${pathStr}`,
		);
		return null;
	}
	if (linkDirs.length > 1) {
		logger.warn(
			`Cannot find any linkDir from linkDirs on the same drive, using first linkDir for symlink: ${pathStr}`,
		);
	}
	return linkDirs[0];
}

export function getLinkDirVirtual(searchee: SearcheeVirtual): string | null {
	const linkDir = getLinkDir(searchee.files[0].path);
	if (!linkDir) return null;
	for (let i = 1; i < searchee.files.length; i++) {
		if (getLinkDir(searchee.files[i].path) !== linkDir) {
			logger.error(
				`Cannot link files to multiple linkDirs for seasonFromEpisodes aggregation, source episodes are spread across multiple drives.`,
			);
			return null;
		}
	}
	return linkDir;
}

function linkFile(
	oldPath: string,
	newPath: string,
	linkType?: LinkType,
): boolean {
	if (!linkType) linkType = getRuntimeConfig().linkType;
	try {
		const ogFileResolvedPath = unwrapSymlinks(oldPath);

		switch (linkType) {
			case LinkType.HARDLINK:
				fs.linkSync(ogFileResolvedPath, newPath);
				break;
			case LinkType.SYMLINK:
				// we need to resolve because symlinks are resolved outside
				// the context of cross-seed's working directory
				fs.symlinkSync(ogFileResolvedPath, resolve(newPath));
				break;
			case LinkType.REFLINK:
				fs.copyFileSync(
					ogFileResolvedPath,
					newPath,
					fs.constants.COPYFILE_FICLONE_FORCE,
				);
				break;
			default:
				throw new Error(`Unsupported linkType: ${linkType}`);
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
		if (!fs.lstatSync(path).isSymbolicLink()) {
			return path;
		}
		path = resolve(dirname(path), fs.readlinkSync(path));
	}
	throw new Error(`too many levels of symbolic links at ${path}`);
}

/**
 * Tests if srcDir supports linkType.
 * @param srcDir The directory to link from
 */
export function testLinking(srcDir: string): void {
	const { linkDirs, linkType } = getRuntimeConfig();
	let tempFile: string | undefined;
	try {
		let srcFile = findAFileWithExt(srcDir, ALL_EXTENSIONS);
		if (!srcFile) {
			tempFile = join(srcDir, srcTestName);
			try {
				fs.writeFileSync(tempFile, "");
				srcFile = tempFile;
			} catch (e) {
				logger.error(e);
				logger.error(
					`Failed to create test file in ${srcDir}, cross-seed is unable to verify linking for this path.`,
				);
				return;
			}
		}
		const linkDir = getLinkDir(srcDir);
		if (!linkDir) throw new Error(`No valid linkDir found for ${srcDir}`);
		const testPath = join(linkDir, linkTestName);
		linkFile(srcFile, testPath);
		fs.rmSync(testPath);
	} catch (e) {
		logger.error(e);
		throw new CrossSeedError(
			`Failed to create a test ${linkType} from ${srcDir} in any linkDirs: [${formatAsList(
				linkDirs.map((d) => `"${d}"`),
				{ sort: false, style: "short", type: "unit" },
			)}]. Ensure that ${linkType} is supported between these paths (hardlink/reflink requires same drive, partition, and volume).`,
		);
	} finally {
		if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
	}
}
