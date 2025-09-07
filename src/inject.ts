import chalk from "chalk";
import { stat, unlink } from "fs/promises";
import ms from "ms";
import { copyFile } from "fs/promises";
import path, { basename } from "path";
import { performActionWithoutMutex } from "./action.js";
import {
	byClientHostPriority,
	TorrentClient,
	waitForTorrentToComplete,
} from "./clients/TorrentClient.js";
import { appDir } from "./configuration.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	isAnyMatchedDecision,
	MediaType,
	SaveResult,
	TORRENT_CACHE_FOLDER,
	UNKNOWN_TRACKER,
	VIDEO_DISC_EXTENSIONS,
} from "./constants.js";
import { assessCandidate } from "./decide.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { findAllSearchees } from "./pipeline.js";
import {
	findBlockedStringInReleaseMaybe,
	logFilterReason,
} from "./preFilter.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
	createEnsembleSearchees,
	createSearcheeFromMetafile,
	getMediaType,
	SearcheeWithLabel,
} from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	parseMetadataFromFilename,
	parseTorrentFromFilename,
} from "./torrent.js";
import {
	areMediaTitlesSimilar,
	comparing,
	exists,
	findFallback,
	formatAsList,
	getLogString,
	hasExt,
	humanReadableDate,
	isTruthy,
	Mutex,
	sanitizeInfoHash,
	withMutex,
} from "./utils.js";

type AllMatches = {
	searchee: SearcheeWithLabel;
	decision: DecisionAnyMatch;
	actionResult?: ActionResult;
}[];

type InjectSummary = {
	TOTAL: number;
	INJECTED: number;
	FULL_MATCHES: number;
	PARTIAL_MATCHES: number;
	BLOCKED: number;
	ALREADY_EXISTS: number;
	INCOMPLETE_CANDIDATES: number;
	INCOMPLETE_SEARCHEES: number;
	FAILED: number;
	UNMATCHED: number;
	FOUND_BAD_FORMAT: boolean;
	PROMISES: Promise<void>[];
};

type InjectionAftermath = {
	summary: InjectSummary;
	torrentFilePath: string;
	client?: TorrentClient;
	clientMatches: AllMatches;
	meta: Metafile;
	matchedDecision?: DecisionAnyMatch;
	tracker: string;
	progress: string;
	injectionResult: InjectionResult;
	matchedSearchee?: SearcheeWithLabel;
	filePathLog: string;
	linkedNewFiles: boolean;
};

function getTorrentFilePathLog(torrentFilePath: string): string {
	return chalk.bold.magenta(
		torrentFilePath.replace(/\[([a-z0-9]{40})].torrent$/i, (match, hash) =>
			match.replace(hash, sanitizeInfoHash(hash)),
		),
	);
}

async function deleteTorrentFileIfSafe(torrentFilePath: string): Promise<void> {
	const { tracker, name, mediaType } = parseMetadataFromFilename(
		basename(torrentFilePath),
	);

	// we are confident cross-seed created the torrent,
	// or it is intended for use with cross-seed
	const isSafeToDelete = tracker && name && mediaType;
	if (!isSafeToDelete) return;
	const filePathLog = getTorrentFilePathLog(torrentFilePath);
	logger.verbose({
		label: Label.INJECT,
		message: `Deleting ${filePathLog}`,
	});
	try {
		await unlink(torrentFilePath);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.error({
				label: Label.INJECT,
				message: `Failed to delete ${filePathLog}: ${e.message}`,
			});
			logger.debug(e);
		}
	}
}

async function deleteTorrentFileIfComplete(
	torrentFilePath: string,
	client: TorrentClient,
	infoHash: string,
): Promise<void> {
	if (await waitForTorrentToComplete(client, infoHash)) {
		await deleteTorrentFileIfSafe(torrentFilePath);
	} else {
		logger.warn({
			label: Label.INJECT,
			message: `Will not delete ${getTorrentFilePathLog(torrentFilePath)}: torrent is incomplete`,
		});
	}
}

async function whichSearcheesMatchTorrent(
	meta: Metafile,
	searchees: SearcheeWithLabel[],
	blockList: string[],
	ignoreTitles: boolean,
): Promise<{
	matches: AllMatches;
	foundBlocked: boolean;
	fuzzyFail: boolean;
}> {
	const isSimilar = (searchee: SearcheeWithLabel, meta: Metafile) =>
		areMediaTitlesSimilar(searchee.title, meta.title) ||
		areMediaTitlesSimilar(searchee.title, meta.name) ||
		areMediaTitlesSimilar(searchee.name, meta.name) ||
		areMediaTitlesSimilar(searchee.name, meta.title);
	let foundBlocked = false;
	let fuzzyFail = false;
	const matches: AllMatches = [];
	for (const searchee of searchees) {
		const { decision } = await assessCandidate(
			meta,
			searchee,
			new Set(),
			[],
		);
		if (!isAnyMatchedDecision(decision)) continue;

		const blockedNote = findBlockedStringInReleaseMaybe(
			searchee,
			blockList,
		);
		if (blockedNote) {
			logFilterReason(
				`it matches the blocklist: ${blockedNote}`,
				searchee,
				getMediaType(searchee),
			);
			foundBlocked = true;
			continue;
		}

		if (!isSimilar(searchee, meta)) {
			if (ignoreTitles) {
				logger.warn({
					label: Label.INJECT,
					message: `Ignoring title mismatch for ${getLogString(meta, chalk.bold.white)} with ${getLogString(searchee, chalk.bold.white)}`,
				});
			} else {
				logger.warn({
					label: Label.INJECT,
					message: `Skipping match for ${getLogString(meta, chalk.bold.white)} with ${getLogString(searchee, chalk.bold.white)} due to title mismatch (use "${chalk.bold.white("cross-seed inject --ignore-titles")}" if this is an erroneous rejection)`,
				});
				fuzzyFail = true;
				continue;
			}
		}

		matches.push({ searchee, decision });
	}

	/**
	 * sort by client priority first for consistency, then
	 * full matches, then size only matches, then partial matches
	 * torrent, then data, then virtual
	 * prefer more files for partials
	 */
	matches.sort(
		comparing(
			(match) => byClientHostPriority(match.searchee.clientHost),
			(match) =>
				// indexOf returns -1 for not found
				-[Decision.MATCH_SIZE_ONLY, Decision.MATCH].indexOf(
					match.decision,
				),
			(match) => !match.searchee.infoHash,
			(match) => !match.searchee.path,
			(match) => -match.searchee.files.length,
		),
	);
	return { matches, foundBlocked, fuzzyFail };
}

async function injectInitialAction(
	meta: Metafile,
	matches: AllMatches,
	tracker: string,
): Promise<{
	client?: TorrentClient;
	clientMatches: AllMatches;
	injectionResult: InjectionResult;
	matchedSearchee?: SearcheeWithLabel;
	matchedDecision?: DecisionAnyMatch;
	linkedNewFiles: boolean;
}> {
	let client: TorrentClient | undefined;
	const clientMatches: AllMatches = [];
	let injectionResult = InjectionResult.FAILURE;
	let matchedSearchee: SearcheeWithLabel | undefined;
	let matchedDecision: DecisionAnyMatch | undefined;
	let linkedNewFiles = false;
	for (const { searchee, decision } of matches) {
		const res = await performActionWithoutMutex(
			meta,
			decision,
			searchee,
			tracker,
			client,
		);
		const actionResult = res.actionResult;
		clientMatches.push({ searchee, decision, actionResult });
		if (actionResult === InjectionResult.FAILURE) {
			if (res.linkedNewFiles) break; // Since we couldn't unlink, process with the next job
			continue;
		}
		if (actionResult === SaveResult.SAVED || !res.client) continue;
		if (res.linkedNewFiles) linkedNewFiles = true;
		if (injectionResult === InjectionResult.SUCCESS) continue;
		if (actionResult === InjectionResult.ALREADY_EXISTS) {
			client = res.client;
			injectionResult = actionResult;
			continue;
		}
		if (actionResult === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (injectionResult === InjectionResult.ALREADY_EXISTS) continue;
			client = res.client;
			injectionResult = actionResult;
			continue;
		}
		client = res.client;
		injectionResult = InjectionResult.SUCCESS;
		matchedSearchee = searchee;
		matchedDecision = decision;
	}
	return {
		client,
		clientMatches,
		injectionResult,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
	};
}

function injectionFailed({
	progress,
	injectionResult,
	summary,
	filePathLog,
}: InjectionAftermath) {
	logger.error({
		label: Label.INJECT,
		message: `${progress} Failed to inject ${filePathLog} - ${chalk.red(injectionResult)}`,
	});
	summary.FAILED++;
}

async function injectFromStalledTorrent({
	meta,
	client,
	clientMatches,
	tracker,
	injectionResult,
	progress,
	filePathLog,
}: InjectionAftermath): Promise<void> {
	let injected = false;
	let linkedNewFiles = false;
	const stalledDecision = Decision.MATCH_PARTIAL; // Should always be considered partial
	for (const { searchee } of clientMatches) {
		const searcheeLog = getLogString(searchee, chalk.bold.white);
		const res = await performActionWithoutMutex(
			meta,
			stalledDecision,
			searchee,
			tracker,
			client,
			{ onlyCompleted: false },
		);
		if (
			res.actionResult === SaveResult.SAVED ||
			res.actionResult === InjectionResult.TORRENT_NOT_COMPLETE
		) {
			continue; // Not possible
		}
		linkedNewFiles = res.linkedNewFiles;
		if (res.actionResult === InjectionResult.FAILURE) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to inject ${filePathLog} using stalled source ${searcheeLog} - ${chalk.yellow(injectionResult)}`,
			});
			continue;
		}
		if (res.actionResult === InjectionResult.ALREADY_EXISTS) continue;
		logger.warn({
			label: Label.INJECT,
			message: `${progress} Injected ${filePathLog} using stalled source ${searcheeLog}, you will need to resume or remove from client - ${chalk.green(injectionResult)}`,
		});
		injected = true;
	}

	if (injected) return;
	if (!(await client!.isTorrentInClient(meta.infoHash)).orElse(false)) return;
	if (linkedNewFiles) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
		});
	} else {
		logger.warn({
			label: Label.INJECT,
			message: `${progress} No new files linked for ${filePathLog}, resume or remove from client - ${chalk.yellow(injectionResult)}`,
		});
	}
}

async function injectionTorrentNotComplete(
	injectionAftermath: InjectionAftermath,
) {
	const { progress, torrentFilePath, injectionResult, summary, filePathLog } =
		injectionAftermath;
	const { linkDirs } = getRuntimeConfig();
	if (
		!linkDirs.length ||
		(await stat(torrentFilePath)).mtimeMs >= Date.now() - ms("1 day")
	) {
		// Normal case where source is likely still downloading
		logger.warn({
			label: Label.INJECT,
			message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}`,
		});
	} else {
		// Since source is stalled, add to client paused so user can resume later if desired
		// Try linking all possible matches as they may have different files
		await injectFromStalledTorrent(injectionAftermath);
	}
	summary.INCOMPLETE_SEARCHEES++;
}

async function injectionAlreadyExists({
	progress,
	torrentFilePath,
	client,
	clientMatches,
	injectionResult,
	summary,
	linkedNewFiles,
	meta,
	filePathLog,
}: InjectionAftermath) {
	const isChecking = (await client!.isTorrentChecking(meta.infoHash)).orElse(
		false,
	);
	let isComplete = (await client!.isTorrentComplete(meta.infoHash)).orElse(
		false,
	);
	const decision =
		findFallback(
			clientMatches,
			[Decision.MATCH, Decision.MATCH_SIZE_ONLY],
			(match, decision) =>
				match.decision === decision &&
				match.actionResult === InjectionResult.ALREADY_EXISTS,
		)?.decision ?? Decision.MATCH_PARTIAL;
	if (linkedNewFiles) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
		});
	} else if (isChecking) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} ${filePathLog} is being checked by client - ${chalk.green(injectionResult)}`,
		});
		summary.PROMISES.push(
			client!.resumeInjection(meta, decision, {
				checkOnce: false,
			}),
		);
	} else if (!isComplete && decision !== Decision.MATCH_PARTIAL) {
		const finalCheckTime =
			(await stat(torrentFilePath)).mtimeMs + ms("1 day");
		if (hasExt(meta.files, VIDEO_DISC_EXTENSIONS)) {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} Skipping recheck for ${filePathLog}: VIDEO_DISC_EXTENSIONS - ${chalk.yellow(injectionResult)}`,
			});
		} else {
			logger.info({
				label: Label.INJECT,
				message: `${progress} Rechecking ${filePathLog} as it's not complete but has all files (final check at ${humanReadableDate(finalCheckTime)}) - ${chalk.yellow(injectionResult)}`,
			});
			await client!.recheckTorrent(meta.infoHash);
		}
		summary.PROMISES.push(
			client!.resumeInjection(meta, decision, {
				checkOnce: false,
			}),
		);
		if (Date.now() >= finalCheckTime) {
			isComplete = true; // Prevent infinite recheck in rare case of corrupted cross seed
		}
	} else {
		if (isComplete) {
			logger.info({
				label: Label.INJECT,
				message: `${progress} ${filePathLog} - ${chalk.yellow(injectionResult)}`,
			});
		} else {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} ${filePathLog} - ${chalk.yellow(injectionResult)} (incomplete)`,
			});
			summary.PROMISES.push(
				client!.resumeInjection(meta, decision, {
					checkOnce: true,
				}),
			);
		}
	}
	summary.ALREADY_EXISTS++;
	summary.INCOMPLETE_CANDIDATES += isComplete ? 0 : 1;
	if (isComplete) {
		await deleteTorrentFileIfSafe(torrentFilePath);
	} else {
		summary.PROMISES.push(
			deleteTorrentFileIfComplete(
				torrentFilePath,
				client!,
				meta.infoHash,
			),
		);
	}
}

function injectionSuccess(
	{
		progress,
		torrentFilePath,
		client,
		injectionResult,
		summary,
		matchedSearchee,
		matchedDecision,
		meta,
		tracker,
		filePathLog,
	}: InjectionAftermath,
	searchees: SearcheeWithLabel[],
) {
	logger.info({
		label: Label.INJECT,
		message: `${progress} Injected ${filePathLog} - ${chalk.green(injectionResult)}`,
	});
	sendResultsNotification(matchedSearchee!, [
		[
			{ decision: matchedDecision!, metafile: meta },
			tracker,
			injectionResult,
		],
	]);
	summary.INJECTED++;
	if (matchedDecision === Decision.MATCH_PARTIAL) {
		summary.PARTIAL_MATCHES++;
	} else {
		summary.FULL_MATCHES++;
	}
	summary.PROMISES.push(
		deleteTorrentFileIfComplete(torrentFilePath, client!, meta.infoHash),
	);
	const res = createSearcheeFromMetafile(meta);
	if (res.isOk()) searchees.push({ ...res.unwrap(), label: Label.INJECT });
}

async function loadMetafile(
	torrentFilePath: string,
	progress: string,
	summary: InjectSummary,
): Promise<Result<{ meta: Metafile; tracker: string }, "FAILED_TO_PARSE">> {
	const filePathLog = getTorrentFilePathLog(torrentFilePath);
	let meta: Metafile;
	try {
		meta = await parseTorrentFromFilename(torrentFilePath);
	} catch (e) {
		logger.error({
			label: Label.INJECT,
			message: `${progress} Failed to parse ${filePathLog}: ${e.message}`,
		});
		logger.debug(e);
		return resultOfErr("FAILED_TO_PARSE");
	}

	const { tracker: trackerFromFilename } = parseMetadataFromFilename(
		basename(torrentFilePath),
	);
	summary.FOUND_BAD_FORMAT ||= !trackerFromFilename;
	const tracker = trackerFromFilename ?? UNKNOWN_TRACKER;
	return resultOf({ meta, tracker });
}

async function injectSavedTorrent(
	progress: string,
	torrentFilePath: string,
	summary: InjectSummary,
	searchees: SearcheeWithLabel[],
	ignoreTitles: boolean,
) {
	const { blockList } = getRuntimeConfig();
	const metafileResult = await loadMetafile(
		torrentFilePath,
		progress,
		summary,
	);
	if (metafileResult.isErr()) return;
	const { meta, tracker } = metafileResult.unwrap();
	const filePathLog = getTorrentFilePathLog(torrentFilePath);

	const metaBlockedString = findBlockedStringInReleaseMaybe(meta, blockList);
	if (metaBlockedString) {
		logger.warn({
			label: Label.INJECT,
			message: `${progress} ${filePathLog} ${chalk.yellow(`is in the blockList: ${metaBlockedString}`)}`,
		});
		summary.BLOCKED++;
		return;
	}

	const { matches, foundBlocked, fuzzyFail } =
		await whichSearcheesMatchTorrent(
			meta,
			searchees,
			blockList,
			ignoreTitles,
		);

	if (!matches.length) {
		if (foundBlocked) {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} ${filePathLog} ${chalk.yellow(`has all matches in the blockList`)}`,
			});
			summary.BLOCKED++;
		} else {
			logger.error({
				label: Label.INJECT,
				message: `${progress} ${filePathLog} ${chalk.red("has no matches")}`,
			});
			summary.UNMATCHED++;
		}
		if (!fuzzyFail) await deleteTorrentFileIfSafe(torrentFilePath);
		return;
	}

	const {
		client,
		clientMatches,
		injectionResult,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
	} = await injectInitialAction(meta, matches, tracker);

	const injectionAftermath: InjectionAftermath = {
		progress,
		torrentFilePath,
		client,
		injectionResult,
		summary,
		meta,
		tracker,
		clientMatches,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
		filePathLog,
	};

	switch (injectionResult) {
		case InjectionResult.SUCCESS:
			injectionSuccess(injectionAftermath, searchees);
			break;
		case InjectionResult.FAILURE:
			injectionFailed(injectionAftermath);
			break;
		case InjectionResult.ALREADY_EXISTS:
			await injectionAlreadyExists(injectionAftermath);
			break;
		case InjectionResult.TORRENT_NOT_COMPLETE:
			await injectionTorrentNotComplete(injectionAftermath);
			break;
	}
}

function logInjectSummary(summary: InjectSummary, flatLinking: boolean) {
	const incompleteMsg = `${chalk.bold.yellow(summary.ALREADY_EXISTS)} existed in client${
		summary.INCOMPLETE_CANDIDATES
			? chalk.dim(` (${summary.INCOMPLETE_CANDIDATES} were incomplete)`)
			: ""
	}`;
	const resultMsg = formatAsList(
		[
			`Injected ${chalk.bold.green(summary.INJECTED)}/${chalk.bold.white(summary.TOTAL)} torrents`,
			summary.FULL_MATCHES &&
				`${chalk.bold.green(summary.FULL_MATCHES)} were full matches`,
			summary.PARTIAL_MATCHES &&
				`${chalk.bold.yellow(summary.PARTIAL_MATCHES)} were partial matches`,
			summary.INCOMPLETE_SEARCHEES &&
				`${chalk.bold.yellow(summary.INCOMPLETE_SEARCHEES)} had incomplete sources`,
			summary.ALREADY_EXISTS && incompleteMsg,
			summary.BLOCKED &&
				`${chalk.bold.yellow(summary.BLOCKED)} were possibly blocklisted`,
			summary.FAILED &&
				`${chalk.bold.red(summary.FAILED)} failed to inject`,
			summary.UNMATCHED &&
				`${chalk.bold.red(summary.UNMATCHED)} had no matches`,
		].filter(isTruthy),
		{ sort: false, type: "unit" },
	);
	logger.info({ label: Label.INJECT, message: chalk.cyan(resultMsg) });

	if (summary.UNMATCHED > 0) {
		logger.info({
			label: Label.INJECT,
			message: `Use "${chalk.bold.white("cross-seed diff")}" to get the reasons two torrents are not considered matches`,
		});
	}

	if (summary.FOUND_BAD_FORMAT && !flatLinking) {
		logger.warn({
			label: Label.INJECT,
			message: `Some torrents could be linked to linkDir/${UNKNOWN_TRACKER} - follow .torrent naming format in the docs to avoid this`,
		});
	}
}

function createSummary(total: number): InjectSummary {
	return {
		TOTAL: total,
		INJECTED: 0,
		FULL_MATCHES: 0,
		PARTIAL_MATCHES: 0,
		BLOCKED: 0,
		ALREADY_EXISTS: 0,
		INCOMPLETE_CANDIDATES: 0,
		INCOMPLETE_SEARCHEES: 0,
		FAILED: 0,
		UNMATCHED: 0,
		FOUND_BAD_FORMAT: false,
		PROMISES: [],
	};
}

export async function injectSavedTorrents(): Promise<void> {
	const { flatLinking, ignoreTitles, injectDir, outputDir } =
		getRuntimeConfig();
	const targetDir = injectDir ?? outputDir;
	const targetDirLog = chalk.bold.magenta(targetDir);

	if (injectDir !== undefined) {
		logger.warn({
			label: Label.INJECT,
			message: `Manually injecting torrents performs minimal filtering which slightly increases chances of false positives, see the docs for more info`,
		});
	}
	if (ignoreTitles) {
		logger.warn({
			label: Label.INJECT,
			message: `Ignoring torrent titles when looking for matches, this may result in false positives`,
		});
	}

	const torrentFilePaths = await findAllTorrentFilesInDir(targetDir);
	if (torrentFilePaths.length === 0) {
		logger.info({
			label: Label.INJECT,
			message: `No torrent files found to inject in ${targetDirLog}`,
		});
		return;
	}
	logger.info({
		label: Label.INJECT,
		message: `Found ${chalk.bold.white(torrentFilePaths.length)} torrent file(s) to inject in ${targetDirLog}`,
	});
	const summary = createSummary(torrentFilePaths.length);
	const realSearchees = await findAllSearchees(Label.INJECT);
	const ensembleSearchees = await createEnsembleSearchees(realSearchees, {
		useFilters: false,
	});
	const searchees = [...realSearchees, ...ensembleSearchees];
	for (const [i, torrentFilePath] of torrentFilePaths.entries()) {
		const progress = chalk.blue(`(${i + 1}/${torrentFilePaths.length})`);
		await withMutex(
			Mutex.CLIENT_INJECTION,
			{ useQueue: true },
			async () => {
				return injectSavedTorrent(
					progress,
					torrentFilePath,
					summary,
					searchees,
					ignoreTitles ?? false,
				);
			},
		);
	}
	logInjectSummary(summary, flatLinking);
	if (injectDir !== undefined) {
		logger.info({
			label: Label.INJECT,
			message: `Waiting on post-injection tasks to complete...`,
		});
		await Promise.all(summary.PROMISES);
	}
}

export async function restoreFromTorrentCache(): Promise<void> {
	const { outputDir } = getRuntimeConfig();
	const torrentFilePaths = await findAllTorrentFilesInDir(
		path.join(appDir(), TORRENT_CACHE_FOLDER),
	);
	if (torrentFilePaths.length === 0) {
		console.log("No torrent files found to restore from cache");
		return;
	}
	console.log(
		`Found ${chalk.bold.white(torrentFilePaths.length)} torrent file(s) to restore from cache, copying to outputDir...`,
	);
	let existed = 0;
	for (const [i, torrentFilePath] of torrentFilePaths.entries()) {
		const dest = path.join(
			outputDir,
			`[${MediaType.OTHER}][${UNKNOWN_TRACKER}]${basename(torrentFilePath)}`,
		);
		if (await exists(dest)) {
			existed++;
			continue;
		}
		await copyFile(torrentFilePath, dest);
		if ((i + 1) % 100 === 0) {
			console.log(
				`${chalk.blue(`(${i + 1}/${torrentFilePaths.length})`)} ${chalk.bold.magenta(dest)}`,
			);
		}
	}
	console.log(
		`Copied ${chalk.bold.green(torrentFilePaths.length - existed)}/${chalk.bold.white(torrentFilePaths.length)} torrent file(s) from cache to outputDir, run "${chalk.bold.white("cross-seed inject")}" to inject into client using your dataDirs`,
	);
}
