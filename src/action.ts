import chalk from "chalk";
import { existsSync, symlinkSync, linkSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { Metafile } from "parse-torrent";
import { getClient } from "./clients/TorrentClient.js";
import {
	Action,
	ActionResult,
	Decision,
	InjectionResult,
	SaveResult,
} from "./constants.js";
import { logger } from "./logger.js";
import { getRuntimeConfig, NonceOptions } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
import { saveTorrentFile } from "./torrent.js";
import { getTag } from "./utils.js";

export async function performAction(
	newMeta: Metafile,
	decision: Decision,
	searchee: Searchee,
	tracker: string,
	nonceOptions: NonceOptions
): Promise<ActionResult> {
	const { action, linkDir } = getRuntimeConfig();

	if (linkDir) {
		if (decision == Decision.MATCH) {
			await linkExact(searchee.path, linkDir);
		} else if (decision == Decision.MATCH_SIZE_ONLY) {
			// Size only matching is only supported for single file or
			// single, nested file torrents.
			const candidateParentDir = path.dirname(newMeta.files[0].path);
			var correctedlinkDir = linkDir;

			// Candidate is single, nested file
			if (candidateParentDir != ".") {
				if (!existsSync(path.join(linkDir, candidateParentDir))) {
					mkdirSync(path.join(linkDir, candidateParentDir));
				}
				correctedlinkDir = path.join(linkDir, candidateParentDir);
			}
			linkFile(
				path.dirname(searchee.path),
				correctedlinkDir,
				path.basename(searchee.path),
				path.basename(newMeta.files[0].path)
			);
		}
	}

	const styledName = chalk.green.bold(newMeta.name);
	const styledTracker = chalk.bold(tracker);
	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
			linkDir ? linkDir : undefined,
			nonceOptions
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
				saveTorrentFile(
					tracker,
					getTag(searchee.name),
					newMeta,
					nonceOptions
				);
				break;
		}
		return result;
	} else {
		saveTorrentFile(tracker, getTag(searchee.name), newMeta, nonceOptions);
		logger.info(`Found ${styledName} on ${styledTracker} - saved`);
		return SaveResult.SAVED;
	}
}

export async function performActions(searchee, matches, nonceOptions) {
	const results: ActionResult[] = [];
	for (const { tracker, assessment } of matches) {
		const result = await performAction(
			assessment.metafile,
			assessment.decision,
			searchee,
			tracker,
			nonceOptions
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
			linkFile(path.dirname(oldPath), newPath, path.basename(oldPath), path.basename(oldPath));
		}
		return;
	}
	if (!existsSync(path.join(newPath, path.basename(oldPath)))) {
		mkdirSync(path.join(newPath, path.basename(oldPath)));
	}
	readdirSync(oldPath).forEach(file => {linkExact(path.join(oldPath, file), path.join(newPath, path.basename(oldPath)))});
}

function linkFile(oldPath:string, newPath: string, oldName: string, newName: string) {
	const { useHardlinks } = getRuntimeConfig();
	if (existsSync(path.join(newPath, newName))) {
        return;
    } if (useHardlinks) {
		linkSync(path.join(oldPath, oldName), path.join(newPath, newName));
	} else {
		symlinkSync(path.join(oldPath, oldName), path.join(newPath, newName));
	}
}