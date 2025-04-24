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
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	isAnyMatchedDecision,
	MediaType,
	SaveResult,
	TORRENT_CACHE_FOLDER,
	UNKNOWN_TRACKER,
} from "./constants.js";
import { assessCandidate } from "./decide.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { findAllSearchees } from "./pipeline.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { Result, resultOf, resultOfErr } from "./Result.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { createEnsembleSearchees, SearcheeWithLabel } from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	parseMetadataFromFilename,
	parseTorrentFromFilename,
} from "./torrent.js";
import {
	areMediaTitlesSimilar,
	comparing,
	exists,
	formatAsList,
	getLogString,
	humanReadableDate,
	isTruthy,
	Mutex,
	sanitizeInfoHash,
	withMutex,
} from "./utils.js";

type AllMatches = {
	searchee: SearcheeWithLabel;
	decision: DecisionAnyMatch;
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
	ignoreTitles: boolean,
): Promise<{ matches: AllMatches; foundBlocked: boolean; fuzzyFail: boolean }> {
	const isSimilar = (searchee: SearcheeWithLabel, meta: Metafile) =>
		areMediaTitlesSimilar(searchee.title, meta.title) ||
		areMediaTitlesSimilar(searchee.title, meta.name) ||
		areMediaTitlesSimilar(searchee.name, meta.name) ||
		areMediaTitlesSimilar(searchee.name, meta.title) ||
		meta.files.some((metaFile) =>
			searchee.files.some((searcheeFile) =>
				areMediaTitlesSimilar(searcheeFile.name, metaFile.name),
			),
		);
	let foundBlocked = false;
	let fuzzyFail = false;
	const matches: AllMatches = [];
	for (const searchee of searchees) {
		const { decision } = await assessCandidate(meta, searchee, new Set());
		if (decision === Decision.BLOCKED_RELEASE) {
			if (isSimilar(searchee, meta)) foundBlocked = true;
			continue;
		} else if (!isAnyMatchedDecision(decision)) {
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
		if (actionResult === InjectionResult.FAILURE) {
			if (res.linkedNewFiles) break; // Since we couldn't unlink, process with the next job
			continue;
		}
		if (actionResult === SaveResult.SAVED || !res.client) continue;
		if (res.linkedNewFiles) linkedNewFiles = true;
		if (injectionResult === InjectionResult.SUCCESS) continue;
		if (actionResult === InjectionResult.ALREADY_EXISTS) {
			client = res.client;
			clientMatches.push({ searchee, decision });
			injectionResult = actionResult;
			continue;
		}
		if (actionResult === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (injectionResult === InjectionResult.ALREADY_EXISTS) continue;
			client = res.client;
			clientMatches.push({ searchee, decision });
			injectionResult = actionResult;
			continue;
		}
		client = res.client;
		clientMatches.push({ searchee, decision });
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
	}

	if ((await client!.isTorrentComplete(meta.infoHash)).isErr()) return;
	if (linkedNewFiles) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
		});
		await client!.recheckTorrent(meta.infoHash);
		void client!.resumeInjection(meta, stalledDecision, {
			checkOnce: false,
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
		clientMatches.find((m) => m.decision === Decision.MATCH)?.decision ??
		clientMatches.find((m) => m.decision === Decision.MATCH_SIZE_ONLY)
			?.decision ??
		Decision.MATCH_PARTIAL;
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
		void client!.resumeInjection(meta, decision, {
			checkOnce: false,
		});
	} else if (!isComplete && decision !== Decision.MATCH_PARTIAL) {
		const finalCheckTime =
			(await stat(torrentFilePath)).mtimeMs + ms("1 day");
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as it's not complete but has all files (final check at ${humanReadableDate(finalCheckTime)}) - ${chalk.yellow(injectionResult)}`,
		});
		await client!.recheckTorrent(meta.infoHash);
		void client!.resumeInjection(meta, decision, {
			checkOnce: false,
		});
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
			void client!.resumeInjection(meta, decision, {
				checkOnce: true,
			});
		}
	}
	summary.ALREADY_EXISTS++;
	summary.INCOMPLETE_CANDIDATES += isComplete ? 0 : 1;
	if (isComplete) {
		await deleteTorrentFileIfSafe(torrentFilePath);
	} else {
		void deleteTorrentFileIfComplete(
			torrentFilePath,
			client!,
			meta.infoHash,
		);
	}
}

function injectionSuccess({
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
}: InjectionAftermath) {
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
	void deleteTorrentFileIfComplete(torrentFilePath, client!, meta.infoHash);
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
	const metafileResult = await loadMetafile(
		torrentFilePath,
		progress,
		summary,
	);
	if (metafileResult.isErr()) return;
	const { meta, tracker } = metafileResult.unwrap();

	const filePathLog = getTorrentFilePathLog(torrentFilePath);
	const metaLog = getLogString(meta, chalk.bold.white);

	const { matches, foundBlocked, fuzzyFail } =
		await whichSearcheesMatchTorrent(meta, searchees, ignoreTitles);

	if (!matches.length && foundBlocked) {
		logger.warn({
			label: Label.INJECT,
			message: `${progress} ${metaLog} ${chalk.yellow("possibly blocklisted")}: ${filePathLog}`,
		});
		summary.BLOCKED++;
		if (!fuzzyFail) await deleteTorrentFileIfSafe(torrentFilePath);
		return;
	} else if (!matches.length) {
		logger.error({
			label: Label.INJECT,
			message: `${progress} ${metaLog} ${chalk.red("has no matches")}: ${filePathLog}`,
		});
		summary.UNMATCHED++;
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
			injectionSuccess(injectionAftermath);
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

function logInjectSummary(
	summary: InjectSummary,
	flatLinking: boolean,
	injectDir: string | undefined,
) {
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
	if (injectDir !== undefined) {
		logger.info({
			label: Label.INJECT,
			message: `Waiting on post-injection tasks to complete...`,
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
	const { realSearchees, ensembleSearchees } = await withMutex(
		Mutex.CREATE_ALL_SEARCHEES,
		async () => {
			const realSearchees = await findAllSearchees(Label.INJECT);
			const ensembleSearchees = await createEnsembleSearchees(
				realSearchees,
				{
					useFilters: false,
				},
			);
			return { realSearchees, ensembleSearchees };
		},
		{ useQueue: true },
	);
	const searchees = [...realSearchees, ...ensembleSearchees];
	for (const [i, torrentFilePath] of torrentFilePaths.entries()) {
		const progress = chalk.blue(`(${i + 1}/${torrentFilePaths.length})`);
		await withMutex(
			Mutex.CLIENT_INJECTION,
			async () => {
				return injectSavedTorrent(
					progress,
					torrentFilePath,
					summary,
					searchees,
					ignoreTitles ?? false,
				);
			},
			{ useQueue: true },
		);
	}
	logInjectSummary(summary, flatLinking, injectDir);
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
