import chalk from "chalk";
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
	const { action } = getRuntimeConfig();

	const styledName = chalk.green.bold(newMeta.name);
	const styledTracker = chalk.bold(tracker);
	if (action === Action.INJECT) {
		const result = await getClient().inject(
			newMeta,
			searchee,
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
