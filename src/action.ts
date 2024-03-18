import chalk from "chalk";
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	statSync,
	symlinkSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
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

function fuzzyLinkSingleFile(
	searchee: Searchee,
	newMeta: Metafile,
	destinationDir: string,
	sourceDir: string
) {
	// Size only matching is only supported for single file or
	// single, nested file torrents.

	const candidateParentDir = dirname(newMeta.files[0].path);
	let correctedLinkDir = destinationDir;
	// Candidate is single, nested file

	// destinationDir is /Movies/PTP
	// newMeta has a file that looks like Movie/Movie/Movie.mkv
	if (candidateParentDir !== ".") {
		correctedLinkDir = join(destinationDir, candidateParentDir);
		mkdirSync(correctedLinkDir, { recursive: true });
	}

	// linking happens
	// we link from <> to /Movies/PTP/Movie/Movie/Movie.mkv

	linkFile(
		searchee.infoHash
			? join(sourceDir, searchee.files[0].path)
			: searchee.path!,
		join(
			correctedLinkDir,
			newMeta.isSingleFileTorrent
				? newMeta.files[0].name
				: basename(newMeta.files[0].path)
		)
	);
}

export async function performAction(
	newMeta: Metafile,
	decision: Decision,
	searchee: Searchee,
	tracker: string
): Promise<ActionResult> {
	const { action, linkDir, legacyLinking } = getRuntimeConfig();
	const fullLinkPath = linkDir
		? legacyLinking
			? linkDir
			: join(linkDir, tracker)
		: undefined;
	const downloadDirResult = await getClient().getDownloadDir(searchee);
	let sourceExists = false;

	if (fullLinkPath) {
		if (searchee.infoHash && downloadDirResult.isErr()) {
			// TODO figure out something better or add logging
			logger.debug(downloadDirResult.unwrapErrOrThrow());
			return InjectionResult.FAILURE;
		}
		const sourceFile = join(
			downloadDirResult.unwrapOrThrow(),
			// there may be a reason we need to use newMeta.files[0].name instead
			searchee.name
		);
		sourceExists = existsSync(sourceFile);
		if (sourceExists) {
			mkdirSync(fullLinkPath, { recursive: true });

			if (decision == Decision.MATCH) {
				linkExact(
					searchee.infoHash ? sourceFile : searchee.path!,
					fullLinkPath
				);
			} else if (decision == Decision.MATCH_SIZE_ONLY) {
				fuzzyLinkSingleFile(
					searchee,
					newMeta,
					fullLinkPath,
					downloadDirResult.unwrapOrThrow()
				);
			}
		}
	}

	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
			linkDir && sourceExists
				? fullLinkPath
				: downloadDirResult.unwrapOrThrow()
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

function linkExact(oldPath: string, newPath: string) {
	if (!newPath) {
		return;
	}
	if (statSync(oldPath).isFile()) {
		if (!existsSync(join(newPath, basename(oldPath)))) {
			linkFile(oldPath, join(newPath, basename(oldPath)));
		}
		return;
	}
	mkdirSync(join(newPath, basename(oldPath)), { recursive: true });
	readdirSync(oldPath).forEach((file) => {
		linkExact(join(oldPath, file), join(newPath, basename(oldPath)));
	});
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
