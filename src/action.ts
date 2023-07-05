import chalk from "chalk";
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	statSync,
	symlinkSync,
} from "fs";
import path from "path";
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

export async function performAction(
	newMeta: Metafile,
	decision: Decision,
	searchee: Searchee,
	tracker: string
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();

	if (searchee.path) {
		if (decision == Decision.MATCH) {
			await linkExact(searchee.path, linkDir);
		} else if (decision == Decision.MATCH_SIZE_ONLY) {
			// Size only matching is only supported for single file or
			// single, nested file torrents.
			const candidateParentDir = path.dirname(newMeta.files[0].path);
			let correctedlinkDir = linkDir;

			// Candidate is single, nested file
			if (candidateParentDir != ".") {
				if (!existsSync(path.join(linkDir, candidateParentDir))) {
					mkdirSync(path.join(linkDir, candidateParentDir));
				}
				correctedlinkDir = path.join(linkDir, candidateParentDir);
			}
			linkFile(
				searchee.path,
				path.join(correctedlinkDir, newMeta.files[0].name)
			);
		}
	}

	const styledName = chalk.green.bold(newMeta.name);
	const styledTracker = chalk.bold(tracker);
	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
			searchee.path ? linkDir : undefined
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
		if (!existsSync(path.join(newPath, path.basename(oldPath)))) {
			linkFile(oldPath, path.join(newPath, path.basename(oldPath)));
		}
		return;
	}

	try {
		mkdirSync(path.join(newPath, path.basename(oldPath)));
	} catch (e) {
		// skip if it already exists
	}
	readdirSync(oldPath).forEach((file) => {
		linkExact(
			path.join(oldPath, file),
			path.join(newPath, path.basename(oldPath))
		);
	});
}

function linkFile(oldPath: string, newPath: string) {
	const { linkType } = getRuntimeConfig();
	if (existsSync(newPath)) return;

	if (linkType === LinkType.HARDLINK) {
		linkSync(oldPath, newPath);
	} else {
		symlinkSync(oldPath, newPath);
	}
}
