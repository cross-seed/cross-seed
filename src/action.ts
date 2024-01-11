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
import { CrossSeedError } from "./errors.js";
import { logger } from "./logger.js";
import { Metafile } from "./parseTorrent.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import { getTag } from "./utils.js";

export async function validateAction(): Promise<void> {
	const { action } = getRuntimeConfig();
	if (action !== Action.INJECT && action !== Action.SAVE) {
		throw new CrossSeedError(
			`Action method "${action}" is invalid. Allowed choices are "save" and "inject".`
		);
	}
}

export async function performAction(
	newMeta: Metafile,
	decision: Decision,
	searchee: Searchee,
	tracker: string
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();
	const trackerLinkDir = linkDir ? join(linkDir, tracker) : undefined;
	if (trackerLinkDir) {
		const downloadDirResult = await getClient().getDownloadDir(searchee);
		if (downloadDirResult.isErr()) {
			// TODO figure out something better or add logging
			return InjectionResult.FAILURE;
		}
		mkdirSync(trackerLinkDir, { recursive: true });

		if (decision == Decision.MATCH) {
			linkExact(
				searchee.infoHash
					? downloadDirResult.unwrapOrThrow()
					: searchee.path!,
				trackerLinkDir
			);
		} else if (decision == Decision.MATCH_SIZE_ONLY) {
			// Size only matching is only supported for single file or
			// single, nested file torrents.
			const candidateParentDir = dirname(newMeta.files[0].path);
			let correctedlinkDir = trackerLinkDir;

			// Candidate is single, nested file
			if (candidateParentDir !== ".") {
				correctedlinkDir = join(trackerLinkDir, candidateParentDir);
				mkdirSync(correctedlinkDir, { recursive: true });
			}
			linkFile(
				searchee.infoHash
					? downloadDirResult.unwrapOrThrow()
					: searchee.path!,

				join(correctedlinkDir, newMeta.files[0].name)
			);
		}
	}

	const styledName = chalk.green.bold(newMeta.name);
	const styledTracker = chalk.bold(tracker);
	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
			trackerLinkDir
		);
		switch (result) {
			case InjectionResult.SUCCESS:
				logger.info(
					`Found ${styledName} on ${styledTracker} - injected`
				);
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
				saveTorrentFile(tracker, getTag(searchee.name), newMeta);
				break;
		}
		return result;
	} else {
		saveTorrentFile(tracker, getTag(searchee.name), newMeta);
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
