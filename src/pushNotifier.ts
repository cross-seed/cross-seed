import {
	ActionResult,
	InjectionResult,
	PROGRAM_NAME,
	SaveResult,
	USER_AGENT,
} from "./constants.js";
import { getPartialSizeRatio, ResultAssessment } from "./decide.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { getSearcheeSource, SearcheeWithLabel } from "./searchee.js";
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
	url?: string;

	constructor(url?: string) {
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
	const { autoResumeMaxDownload } = getRuntimeConfig();
	const source = searchee.label;
	const searcheeCategory = searchee.category ?? null;
	const searcheeTags = searchee.tags ?? null;
	const searcheeTrackers = searchee.trackers ?? null;
	const searcheeLength = searchee.length;
	const searcheeInfoHash = searchee.infoHash ?? null;
	const searcheePath = searchee.path ?? null;
	const searcheeSource = getSearcheeSource(searchee);

	const notableSuccesses = results.filter(
		([, , actionResult]) =>
			actionResult === InjectionResult.SUCCESS ||
			actionResult === SaveResult.SAVED,
	);
	if (notableSuccesses.length) {
		const name = notableSuccesses[0][0].metafile!.name;
		const numTrackers = notableSuccesses.length;
		const infoHashes = notableSuccesses.map(
			([{ metafile }]) => metafile!.infoHash,
		);
		const trackers = notableSuccesses.map(([, tracker]) => tracker);
		const trackersListStr = formatAsList(trackers, { sort: true });
		const paused = notableSuccesses.some(
			([{ metafile }]) =>
				(1 - getPartialSizeRatio(metafile!, searchee)) *
					metafile!.length >
				autoResumeMaxDownload,
		);
		const injected = notableSuccesses.some(
			([, , actionResult]) => actionResult === InjectionResult.SUCCESS,
		);
		const performedAction = injected
			? `Injected${paused ? " (paused)" : ""}`
			: "Saved";
		const decisions = notableSuccesses.map(([{ decision }]) => decision);

		pushNotifier.notify({
			body: `${source}: ${performedAction} ${name} on ${numTrackers} tracker${numTrackers !== 1 ? "s" : ""} by ${formatAsList(decisions, { sort: true })} from ${searcheeSource}: ${trackersListStr}`,
			extra: {
				event: Event.RESULTS,
				name,
				infoHashes,
				trackers,
				source,
				result: injected ? InjectionResult.SUCCESS : SaveResult.SAVED,
				paused,
				decisions,
				searchee: {
					category: searcheeCategory,
					tags: searcheeTags,
					trackers: searcheeTrackers,
					length: searcheeLength,
					infoHash: searcheeInfoHash,
					path: searcheePath,
					source: searcheeSource,
				},
			},
		});
	}

	const failures = results.filter(
		([, , actionResult]) => actionResult === InjectionResult.FAILURE,
	);
	if (failures.length) {
		const name = failures[0][0].metafile!.name;
		const numTrackers = failures.length;
		const infoHashes = failures.map(([{ metafile }]) => metafile!.infoHash);
		const trackers = failures.map(([, tracker]) => tracker);
		const trackersListStr = formatAsList(trackers, { sort: true });
		const decisions = failures.map(([{ decision }]) => decision);

		pushNotifier.notify({
			body: `${source}: Failed to inject ${name} on ${numTrackers} tracker${numTrackers !== 1 ? "s" : ""} by ${formatAsList(decisions, { sort: true })} from ${searcheeSource}: ${trackersListStr}`,
			extra: {
				event: Event.RESULTS,
				name,
				infoHashes,
				trackers,
				source,
				result: failures[0][2],
				paused: false,
				decisions,
				searchee: {
					category: searcheeCategory,
					tags: searcheeTags,
					trackers: searcheeTrackers,
					length: searcheeLength,
					infoHash: searcheeInfoHash,
					path: searcheePath,
					source: searcheeSource,
				},
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
