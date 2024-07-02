import {
	ActionResult,
	InjectionResult,
	SaveResult,
	PROGRAM_NAME,
	USER_AGENT,
} from "./constants.js";
import { ResultAssessment } from "./decide.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { SearcheeWithLabel } from "./searchee.js";
import { formatAsList } from "./utils.js";

export let pushNotifier: PushNotifier;
enum Event {
	RESULTS = "RESULTS",
}
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

	async notify({
		title = PROGRAM_NAME,
		body,
		...rest
	}: PushNotification): Promise<void> {
		if (this.url) {
			try {
				const response = await fetch(this.url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"User-Agent": USER_AGENT,
					},
					body: JSON.stringify({ title, body, ...rest }),
				});

				if (!response.ok) {
					logger.error({
						message: "Failed to send push notification",
					});
					logger.debug({
						message: `Server response: ${response.status} ${response.statusText}`,
					});
				}
			} catch (error) {
				logger.error({
					message: "Failed to send push notification",
				});
				logger.debug({
					message: error,
				});
			}
		}
	}
}

export function sendResultsNotification(
	searchee: SearcheeWithLabel,
	results: [ResultAssessment, TrackerName, ActionResult][],
) {
	const name = searchee.name;
	const source = searchee.label;
	const notableSuccesses = results.filter(
		([, , actionResult]) =>
			actionResult === InjectionResult.SUCCESS ||
			actionResult === SaveResult.SAVED,
	);
	const failures = results.filter(
		([, , actionResult]) => actionResult === InjectionResult.FAILURE,
	);
	if (notableSuccesses.length) {
		const numTrackers = notableSuccesses.length;
		const infoHashes = notableSuccesses.map(
			([assessment]) => assessment.metafile!.infoHash,
		);
		const trackers = notableSuccesses.map(([, tracker]) => tracker);
		const trackersListStr = formatAsList(trackers);
		const performedAction =
			notableSuccesses[0][2] === InjectionResult.SUCCESS
				? "Injected"
				: "Saved";
		pushNotifier.notify({
			body: `${source}: ${performedAction} ${name} from ${numTrackers} trackers: ${trackersListStr}`,
			extra: {
				event: Event.RESULTS,
				name,
				infoHashes,
				trackers,
				source,
				result: notableSuccesses[0][2],
			},
		});
	}

	if (failures.length) {
		const numTrackers = failures.length;
		const infoHashes = failures.map(
			([assessment]) => assessment.metafile!.infoHash,
		);
		const trackers = failures.map(([, tracker]) => tracker);
		const trackersListStr = formatAsList(trackers);

		pushNotifier.notify({
			body: `Failed to inject ${name} from ${numTrackers} trackers: ${trackersListStr}`,
			extra: {
				event: Event.RESULTS,
				name,
				infoHashes,
				trackers,
				source,
				result: failures[0][2],
			},
		});
	}
}

export function initializePushNotifier(): void {
	const { notificationWebhookUrl } = getRuntimeConfig();
	pushNotifier = new PushNotifier(notificationWebhookUrl);
}

export function sendTestNotification(): void {
	pushNotifier.notify({ body: "Test", extra: { event: "TEST" } });
	logger.info("Sent test notification");
}
