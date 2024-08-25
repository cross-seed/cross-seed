import chalk from "chalk";
import fs from "fs";
import { unlink } from "fs/promises";
import ms from "ms";
import { basename, dirname } from "path";
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
	parseMetadataFromFilename,
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
				message: `Failed to delete ${filePathLog}`,
			});
			logger.debug(e);
		}
	}
}

async function whichSearcheesMatchTorrent(
	meta: Metafile,
	searchees: SearcheeWithLabel[],
): Promise<{ matches: AllMatches; foundBlocked: boolean }> {
	let foundBlocked = false;
	const matches: AllMatches = [];
	for (const searchee of searchees) {
		const { decision } = await assessCandidate(meta, searchee, []);
		if (decision === Decision.BLOCKED_RELEASE) {
			foundBlocked = true;
			continue;
		} else if (!isAnyMatchedDecision(decision)) {
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
				message: `Skipping likely false positive for ${getLogString(meta, chalk.bold.white)} from ${getLogString(searchee, chalk.bold.white)}`,
			});
			continue;
		}

		matches.push({ searchee, decision });
	}

	/**
	 * full matches, then size only matches, then partial matches
	 * torrent, then data, then virtual
	 * prefer more files for partials
	 */
	matches.sort(
		comparing(
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
	return { matches, foundBlocked };
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
	anyFullMatch: boolean,
	isComplete: boolean,
): Promise<boolean> {
	if (linkedNewFiles) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as new files were linked - ${chalk.green(injectionResult)}`,
		});
		await getClient().recheckTorrent(meta.infoHash);
	} else if (anyFullMatch && !isComplete) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} Rechecking ${filePathLog} as it's not complete but has all files - ${chalk.green(injectionResult)}`,
		});
		await getClient().recheckTorrent(meta.infoHash);
		isComplete = true; // Prevent infinite recheck in rare case of corrupted cross seed
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

async function injectionSuccess(
	progress: string,
	filePathLog: string,
	injectionResult: InjectionResult,
	summary: InjectSummary,
	matchedSearchee: SearcheeWithLabel,
	matchedDecision: DecisionAnyMatch,
	meta: Metafile,
	tracker: string,
	torrentFilePath: string,
): Promise<void> {
	logger.info({
		label: Label.INJECT,
		message: `${progress} Injected ${filePathLog} - ${chalk.green(injectionResult)}`,
	});
	sendResultsNotification(matchedSearchee, [
		[
			{ decision: matchedDecision, metafile: meta },
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

	const result = await getClient().isTorrentComplete(meta.infoHash);
	const isComplete = result.isOk() ? result.unwrap() : false;
	if (isComplete) {
		await deleteTorrentFileIfSafe(torrentFilePath);
	}
}

async function injectSavedTorrent(
	count: number,
	torrentFilePaths: string[],
	torrentFilePath: string,
	summary: InjectSummary,
	searchees: SearcheeWithLabel[],
) {
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
		return;
	}
	const metaLog = getLogString(meta, chalk.bold.white);

	const { tracker: trackerFromFilename } = parseMetadataFromFilename(
		basename(torrentFilePath),
	);
	summary.FOUND_BAD_FORMAT ||= !trackerFromFilename;
	const tracker = trackerFromFilename ?? UNKNOWN_TRACKER;

	const { matches, foundBlocked } = await whichSearcheesMatchTorrent(
		meta,
		searchees,
	);
	if (!matches.length && foundBlocked) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} ${metaLog} ${chalk.yellow("possibly blocklisted")}: ${filePathLog}`,
		});
		summary.BLOCKED++;
		await deleteTorrentFileIfSafe(torrentFilePath);
		return;
	} else if (!matches.length) {
		logger.info({
			label: Label.INJECT,
			message: `${progress} ${metaLog} ${chalk.red("has no matches")}: ${filePathLog}`,
		});
		summary.UNMATCHED++;
		await deleteTorrentFileIfSafe(torrentFilePath);
		return;
	}

	const {
		injectionResult,
		matchedSearchee,
		matchedDecision,
		linkedNewFiles,
	} = await injectInitialAction(meta, matches, tracker);
	switch (injectionResult) {
		case InjectionResult.SUCCESS: {
			await injectionSuccess(
				progress,
				filePathLog,
				injectionResult,
				summary,
				matchedSearchee!,
				matchedDecision!,
				meta,
				tracker,
				torrentFilePath,
			);
			break;
		}
		case InjectionResult.FAILURE:
			injectionFailed(progress, filePathLog, injectionResult, summary);
			break;
		case InjectionResult.ALREADY_EXISTS: {
			const result = await getClient().isTorrentComplete(meta.infoHash);
			let isComplete = result.isOk() ? result.unwrap() : false;
			const anyFullMatch = matches.some(
				(m) =>
					m.decision === Decision.MATCH ||
					m.decision === Decision.MATCH_SIZE_ONLY,
			);
			isComplete = await injectionAlreadyExists(
				progress,
				filePathLog,
				injectionResult,
				summary,
				linkedNewFiles,
				meta,
				anyFullMatch,
				isComplete,
			);
			if (isComplete) {
				await deleteTorrentFileIfSafe(torrentFilePath);
			}
			break;
		}
		case InjectionResult.TORRENT_NOT_COMPLETE:
			await injectionTorrentNotComplete(
				progress,
				torrentFilePath,
				injectionResult,
				summary,
				meta,
				matches,
				tracker,
			);
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
	};
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
	const summary = createSummary(torrentFilePaths.length);
	const searchees = await findAllSearchees(Label.INJECT);
	for (const [i, torrentFilePath] of torrentFilePaths.entries()) {
		await injectSavedTorrent(
			i,
			torrentFilePaths,
			torrentFilePath,
			summary,
			searchees,
		);
	}
	logInjectSummary(summary, flatLinking);
}
