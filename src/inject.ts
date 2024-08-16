import chalk from "chalk";
import fs from "fs";
import ms from "ms";
import { dirname } from "path";
import { linkAllFilesInMetafile, performAction } from "./action.js";
import { getClient } from "./clients/TorrentClient.js";
import {
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	isAnyMatchedDecision,
	SaveResult,
	UNKNOWN_TRACKER,
} from "./constants.js";
import { assessCandidate } from "./decide.js";
import { Label, logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { findAllSearchees } from "./pipeline.js";
import { sendResultsNotification } from "./pushNotifier.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { SearcheeWithLabel } from "./searchee.js";
import {
	findAllTorrentFilesInDir,
	parseInfoFromSavedTorrent,
	parseTorrentFromFilename,
} from "./torrent.js";
import {
	areMediaTitlesSimilar,
	comparing,
	formatAsList,
	getLogString,
	isTruthy,
	sanitizeInfoHash,
} from "./utils.js";

type AllMatches = {
	searchee: SearcheeWithLabel;
	decision: DecisionAnyMatch;
}[];
type FullMatches = {
	searchee: SearcheeWithLabel;
	decision: Decision.MATCH | Decision.MATCH_SIZE_ONLY;
}[];
type PartialMatches = {
	searchee: SearcheeWithLabel;
	decision: Decision.MATCH_PARTIAL;
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
	FLAT_LINKING: boolean;
};

function getTorrentFilePathLog(torrentFilePath: string): string {
	return chalk.bold.magenta(
		torrentFilePath.replace(/\[([a-z0-9]{40})].torrent$/i, (match, hash) =>
			match.replace(hash, sanitizeInfoHash(hash)),
		),
	);
}

function deleteTorrentFileIfEligible(
	torrentFilePath: string,
	options: { isComplete: boolean; cleanUpOldTorrents: boolean },
): void {
	const filePathLog = getTorrentFilePathLog(torrentFilePath);
	try {
		if (options?.isComplete) {
			logger.verbose({
				label: Label.INJECT,
				message: `Deleting ${filePathLog} as it's in client and complete`,
			});
			fs.unlinkSync(torrentFilePath);
			return;
		}
		if (!options.cleanUpOldTorrents) return;
		if (fs.statSync(torrentFilePath).mtimeMs < Date.now() - ms("1 week")) {
			logger.warn({
				label: Label.INJECT,
				message: `Deleting ${filePathLog} as it has failed to inject for too long`,
			});
			fs.unlinkSync(torrentFilePath);
		}
	} catch (e) {
		logger.error({
			label: Label.INJECT,
			message: `Failed to delete ${filePathLog}`,
		});
		logger.debug(e);
	}
}

async function injectDecideStage(
	meta: Metafile,
	searchees: SearcheeWithLabel[],
): Promise<{
	fullMatches: FullMatches;
	partialMatches: PartialMatches;
	foundBlocked: boolean;
}> {
	const fullMatches: FullMatches = [];
	const partialMatches: PartialMatches = [];
	let foundBlocked = false;
	for (const searchee of searchees) {
		const { decision } = await assessCandidate(meta, searchee, []);
		if (!isAnyMatchedDecision(decision)) {
			if (decision === Decision.BLOCKED_RELEASE) {
				foundBlocked = true;
			}
			continue;
		}

		// If name or file names are not similar consider it a false positive
		if (
			!areMediaTitlesSimilar(searchee.title, meta.title) &&
			!areMediaTitlesSimilar(searchee.title, meta.name) &&
			!areMediaTitlesSimilar(searchee.name, meta.name) &&
			!areMediaTitlesSimilar(searchee.name, meta.title) &&
			!meta.files.some((metaFile) =>
				searchee.files.some((searcheeFile) =>
					areMediaTitlesSimilar(searcheeFile.name, metaFile.name),
				),
			)
		) {
			logger.warn({
				label: Label.INJECT,
				message: `Skipping potential false positive for ${getLogString(meta, chalk.bold.white)} from ${getLogString(searchee, chalk.bold.white)}`,
			});
			continue;
		}

		if (decision === Decision.MATCH) {
			fullMatches.unshift({ searchee, decision });
		} else if (decision === Decision.MATCH_SIZE_ONLY) {
			fullMatches.push({ searchee, decision });
		} else {
			partialMatches.push({ searchee, decision });
		}
	}
	fullMatches.sort(comparing((match) => !match.searchee.infoHash));
	partialMatches.sort(
		comparing(
			(match) => !(match.searchee.infoHash || match.searchee.path),
			(match) => -match.searchee.files.length,
		),
	);
	return { fullMatches, partialMatches, foundBlocked };
}

async function injectInitialAction(
	meta: Metafile,
	matches: AllMatches,
	tracker: string,
): Promise<{
	injectionResult: InjectionResult;
	matchedSearchee?: SearcheeWithLabel;
	matchedDecision?: DecisionAnyMatch;
	linkedNewFiles: boolean;
}> {
	let injectionResult = InjectionResult.FAILURE;
	let matchedSearchee: SearcheeWithLabel | undefined;
	let matchedDecision: DecisionAnyMatch | undefined;
	let linkedNewFiles = false;
	for (const { searchee, decision } of matches) {
		if (
			injectionResult === InjectionResult.TORRENT_NOT_COMPLETE &&
			!searchee.infoHash
		) {
			continue; // Data/virtual searchee doesn't know if torrent is complete
		}
		const res = await performAction(meta, decision, searchee, tracker);
		const result = res.actionResult;
		if (res.linkedNewFiles) {
			linkedNewFiles = true;
		}
		if (
			injectionResult === InjectionResult.SUCCESS ||
			result === InjectionResult.FAILURE ||
			result === SaveResult.SAVED
		) {
			continue;
		}
		if (result === InjectionResult.ALREADY_EXISTS) {
			injectionResult = result;
			continue;
		}
		if (result === InjectionResult.TORRENT_NOT_COMPLETE) {
			if (injectionResult !== InjectionResult.ALREADY_EXISTS) {
				injectionResult = result;
				matchedSearchee = searchee;
				matchedDecision = decision;
			}
			continue;
		}
		injectionResult = InjectionResult.SUCCESS;
		matchedSearchee = searchee;
		matchedDecision = decision;
	}
	return {
		injectionResult,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
	};
}

function injectionFailed(
	progress: string,
	filePathLog: string,
	injectionResult: InjectionResult,
	summary: InjectSummary,
): void {
	logger.error({
		label: Label.INJECT,
		message: `${progress} Failed to inject ${filePathLog} - ${chalk.red(injectionResult)}`,
	});
	summary.FAILED++;
}

async function injectFromStalledTorrent(
	meta: Metafile,
	matches: AllMatches,
	tracker: string,
	injectionResult: InjectionResult,
	progress: string,
	filePathLog: string,
): Promise<boolean> {
	let linkedNewFiles = false;
	let inClient = (await getClient().isTorrentComplete(meta.infoHash)).isOk();
	let injected = false;
	for (const { searchee, decision } of matches) {
		const linkedFilesRootResult = await linkAllFilesInMetafile(
			searchee,
			meta,
			tracker,
			decision,
			{ onlyCompleted: false },
		);
		const linkResult = linkedFilesRootResult.isOk()
			? linkedFilesRootResult.unwrap()
			: null;
		if (linkResult && linkResult.linkedNewFiles) {
			linkedNewFiles = true;
		}
		if (!inClient) {
			if (linkedFilesRootResult.isOk()) {
				const destinationDir = dirname(linkResult!.contentPath);
				const result = await getClient().inject(
					meta,
					searchee,
					Decision.MATCH_PARTIAL, // Should always be considered partial
					destinationDir,
				);
				// result is only SUCCESS or FAILURE here but still log original injectionResult
				if (result === InjectionResult.SUCCESS) {
					logger.info({
						label: Label.INJECT,
						message: `${progress} Injected ${filePathLog} using stalled source, you will need to resume or remove from client - ${chalk.green(injectionResult)}`,
					});
					inClient = true;
					injected = true;
				} else {
					logger.warn({
						label: Label.INJECT,
						message: `${progress} Failed to inject ${filePathLog} using stalled source - ${chalk.yellow(injectionResult)}`,
					});
				}
			} else {
				logger.warn({
					label: Label.INJECT,
					message: `${progress} Failed to link files for ${filePathLog}, ${linkedFilesRootResult.unwrapErr()} - ${chalk.yellow(injectionResult)}`,
				});
			}
		}
	}
	if (inClient && !injected) {
		if (linkedNewFiles) {
			logger.info({
				label: Label.INJECT,
				message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
			});
			await getClient().recheckTorrent(meta.infoHash);
		} else {
			logger.warn({
				label: Label.INJECT,
				message: `${progress} No new files linked for ${filePathLog}, resume or remove from client - ${chalk.yellow(injectionResult)}`,
			});
		}
	}
	return injected;
}

async function injectionTorrentNotComplete(
	progress: string,
	torrentFilePath: string,
	injectionResult: InjectionResult,
	summary: InjectSummary,
	meta: Metafile,
	matches: AllMatches,
	tracker: string,
): Promise<void> {
	const { linkDir } = getRuntimeConfig();
	const filePathLog = getTorrentFilePathLog(torrentFilePath);
	if (
		!linkDir ||
		fs.statSync(torrentFilePath).mtimeMs >= Date.now() - ms("1 day")
	) {
		// Normal case where source is likely still downloading
		logger.warn({
			label: Label.INJECT,
			message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}`,
		});
	} else {
		// Since source is stalled, add to client paused so user can resume later if desired
		// Try linking all possible matches as they may have different files
		await injectFromStalledTorrent(
			meta,
			matches,
			tracker,
			injectionResult,
			progress,
			filePathLog,
		);
	}
	summary.INCOMPLETE_SEARCHEES++;
}

async function injectionAlreadyExists(
	progress: string,
	filePathLog: string,
	injectionResult: InjectionResult,
	summary: InjectSummary,
	linkedNewFiles: boolean,
	meta: Metafile,
	fullMatches: FullMatches,
	isComplete: boolean,
	torrentFilePath: string,
	options: { cleanUpOldTorrents: boolean },
): Promise<boolean> {
	if (linkedNewFiles) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
		});
		await getClient().recheckTorrent(meta.infoHash);
	} else if (fullMatches.length && !isComplete) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as it's not complete but has all files - ${chalk.green(injectionResult)}`,
		});
		isComplete = true;
		await getClient().recheckTorrent(meta.infoHash);
		// Prevent infinite recheck in rare case of corrupted cross seed
		deleteTorrentFileIfEligible(torrentFilePath, {
			isComplete,
			cleanUpOldTorrents: options.cleanUpOldTorrents,
		});
	} else {
		logger.warn({
			label: Label.INJECT,
			message: `${progress} Unable to inject ${filePathLog} - ${chalk.yellow(injectionResult)}${isComplete ? "" : " (incomplete)"}`,
		});
	}
	summary.ALREADY_EXISTS++;
	summary.INCOMPLETE_CANDIDATES += isComplete ? 0 : 1;
	return isComplete;
}

function injectionSuccess(
	progress: string,
	filePathLog: string,
	injectionResult: InjectionResult,
	summary: InjectSummary,
	matchedSearchee: SearcheeWithLabel,
	matchedDecision: DecisionAnyMatch,
	meta: Metafile,
	tracker: string,
): void {
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
	if (matchedDecision! === Decision.MATCH_PARTIAL) {
		summary.PARTIAL_MATCHES++;
	} else {
		summary.FULL_MATCHES++;
	}
}

async function injectTorrentFiles(
	torrentFilePaths: string[],
	summary: InjectSummary,
	options: { cleanUpOldTorrents: boolean },
): Promise<void> {
	const searchees = await findAllSearchees(Label.INJECT);

	let count = 0;
	for (const torrentFilePath of torrentFilePaths) {
		const progress = chalk.blue(`(${++count}/${torrentFilePaths.length})`);
		const filePathLog = getTorrentFilePathLog(torrentFilePath);
		let meta: Metafile;
		try {
			meta = await parseTorrentFromFilename(torrentFilePath);
		} catch (e) {
			logger.error({
				label: Label.INJECT,
				message: `${progress} Failed to parse ${filePathLog}`,
			});
			logger.debug(e);
			deleteTorrentFileIfEligible(torrentFilePath, {
				isComplete: false,
				cleanUpOldTorrents: options.cleanUpOldTorrents,
			});
			continue;
		}
		const metaLog = getLogString(meta, chalk.bold.white);

		const torrentNameInfo =
			await parseInfoFromSavedTorrent(torrentFilePath);
		const tracker = torrentNameInfo?.tracker ?? UNKNOWN_TRACKER;
		if (tracker === UNKNOWN_TRACKER) {
			summary.FOUND_BAD_FORMAT = true;
		}

		const { fullMatches, partialMatches, foundBlocked } =
			await injectDecideStage(meta, searchees);
		const matches: AllMatches = [...fullMatches, ...partialMatches];
		if (!matches.length) {
			if (foundBlocked) {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.yellow("possibly blocklisted")}: ${filePathLog}`,
				});
				summary.BLOCKED++;
			} else {
				logger.info({
					label: Label.INJECT,
					message: `${progress} ${metaLog} ${chalk.red("has no matches")}: ${filePathLog}`,
				});
				summary.UNMATCHED++;
			}
			deleteTorrentFileIfEligible(torrentFilePath, {
				isComplete: false,
				cleanUpOldTorrents: options.cleanUpOldTorrents,
			});
			continue;
		}

		const {
			injectionResult,
			matchedSearchee,
			matchedDecision,
			linkedNewFiles,
		} = await injectInitialAction(meta, matches, tracker);
		if (injectionResult === InjectionResult.FAILURE) {
			injectionFailed(progress, filePathLog, injectionResult, summary);
			continue; // Never delete failed torrent files
		}
		if (injectionResult === InjectionResult.TORRENT_NOT_COMPLETE) {
			await injectionTorrentNotComplete(
				progress,
				torrentFilePath,
				injectionResult,
				summary,
				meta,
				matches,
				tracker,
			);
			deleteTorrentFileIfEligible(torrentFilePath, {
				isComplete: false,
				cleanUpOldTorrents: options.cleanUpOldTorrents,
			});
			continue;
		}
		const result = await getClient().isTorrentComplete(meta.infoHash);
		let isComplete = result.isOk() ? result.unwrap() : false;
		deleteTorrentFileIfEligible(torrentFilePath, {
			isComplete,
			cleanUpOldTorrents: options.cleanUpOldTorrents,
		});
		if (injectionResult === InjectionResult.ALREADY_EXISTS) {
			isComplete = await injectionAlreadyExists(
				progress,
				filePathLog,
				injectionResult,
				summary,
				linkedNewFiles,
				meta,
				fullMatches,
				isComplete,
				torrentFilePath,
				{ cleanUpOldTorrents: options.cleanUpOldTorrents },
			);
			continue;
		}
		injectionSuccess(
			progress,
			filePathLog,
			injectionResult,
			summary,
			matchedSearchee!,
			matchedDecision!,
			meta,
			tracker,
		);
	}
}

function logInjectSummary(summary: InjectSummary) {
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

	if (summary.FOUND_BAD_FORMAT && !summary.FLAT_LINKING) {
		logger.warn({
			label: Label.INJECT,
			message: `Some torrents could be linked to linkDir/${UNKNOWN_TRACKER} - follow .torrent naming format in the docs to avoid this`,
		});
	}
}

export async function injectSavedTorrents(): Promise<void> {
	const { flatLinking, injectDir, outputDir } = getRuntimeConfig();
	const targetDir = injectDir ?? outputDir;
	const targetDirLog = chalk.bold.magenta(targetDir);

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

	const summary: InjectSummary = {
		TOTAL: torrentFilePaths.length,
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
		FLAT_LINKING: flatLinking,
	};
	const cleanUpOldTorrents = targetDir === outputDir;

	await injectTorrentFiles(torrentFilePaths, summary, { cleanUpOldTorrents });
	logInjectSummary(summary);
}
