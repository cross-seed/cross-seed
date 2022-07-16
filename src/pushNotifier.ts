import fetch from "node-fetch";
import { ActionResult, InjectionResult, SaveResult } from "./constants.js";
import { ResultAssessment } from "./decide.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";

export let pushNotifier: PushNotifier;

type TrackerName = string;

interface PushNotification {
	title?: string;
	body: string;
	extra?: Record<string, unknown>;
}

export class PushNotifier {
	url: string;
	constructor(url: string) {
		this.url = url;
	}

	notify({ title = "cross-seed", body, ...rest }: PushNotification): void {
		if (this.url) {
			fetch(this.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title, body, ...rest }),
			}).catch(() => {
				logger.error({ message: "" });
			});
		}
	}
}

function formatTrackersAsList(trackers: TrackerName[]) {
	// @ts-expect-error Intl.ListFormat totally exists on node 12
	return new Intl.ListFormat("en", {
		style: "long",
		type: "conjunction",
	}).format(trackers);
}

export function sendResultsNotification(
	searchee: Searchee,
	results: [ResultAssessment, TrackerName, ActionResult][]
) {
	const name = searchee.name;
	const notableSuccesses = results.filter(
		([, , actionResult]) =>
			actionResult === InjectionResult.SUCCESS ||
			actionResult === SaveResult.SAVED
	);
	const failures = results.filter(
		([, , actionResult]) => actionResult === InjectionResult.FAILURE
	);
	if (notableSuccesses.length) {
		const name = searchee.name;
		const numTrackers = notableSuccesses.length;
		const infoHashes = notableSuccesses.map(
			([assessment]) => assessment.metafile.infoHash
		);
		const trackers = notableSuccesses.map(([, tracker]) => tracker);
		const trackersListStr = formatTrackersAsList(trackers);
		pushNotifier.notify({
			body: `Injected ${name} from ${numTrackers} trackers: ${trackersListStr}`,
			extra: { infoHashes, trackers },
		});
	}

	if (failures.length) {
		const numTrackers = failures.length;
		const infoHashes = failures.map(
			([assessment]) => assessment.metafile.infoHash
		);
		const trackers = failures.map(([, tracker]) => tracker);
		const trackersListStr = formatTrackersAsList(trackers);
		pushNotifier.notify({
			body: `Failed to inject ${name} from ${numTrackers} trackers: ${trackersListStr}`,
			extra: { infoHashes, trackers },
		});
	}
}

export function initializePushNotifier(): void {
	const { notificationWebhookUrl } = getRuntimeConfig();
	pushNotifier = new PushNotifier(notificationWebhookUrl);
}

export function sendTestNotification(): void {
	pushNotifier.notify({ body: "Test" });
	logger.info("Sent test notification");
}
