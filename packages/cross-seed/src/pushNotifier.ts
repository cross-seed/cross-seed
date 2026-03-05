import ms from "ms";
import { WebhookEntry } from "@cross-seed/shared/configSchema";
import { estimatePausedStatus } from "./clients/TorrentClient.js";
import {
	ActionResult,
	Decision,
	DecisionAnyMatch,
	InjectionResult,
	PROGRAM_NAME,
	SaveResult,
	USER_AGENT,
} from "./constants.js";
import { ResultAssessment } from "./decide.js";
import { logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { getSearcheeSource, SearcheeWithLabel } from "./searchee.js";
import { findFallback, formatAsList, mapAsync } from "./utils.js";

export let pushNotifier: PushNotifier;

enum Event {
	TEST = "TEST",
	RESULTS = "RESULTS",
}

type TrackerName = string;

export interface WebhookResult {
	url: string;
	ok: boolean;
	error?: string;
}

interface PushNotification {
	title?: string;
	body: string;
	extra?: Record<string, unknown>;
}

export class PushNotifier {
	entries: WebhookEntry[];

	constructor(entries: WebhookEntry[]) {
		this.entries = entries;
	}

	async notify({
		title = PROGRAM_NAME,
		body,
		...rest
	}: PushNotification): Promise<WebhookResult[]> {
		return mapAsync(this.entries, async (entry) => {
			const isObject = typeof entry !== "string";
			const url = isObject ? entry.url : entry;
			try {
				const defaultHeaders: Record<string, string> = {
					"Content-Type": "application/json",
					"User-Agent": USER_AGENT,
				};
				const headers = isObject
					? { ...defaultHeaders, ...entry.headers }
					: defaultHeaders;

				const payload = isObject
					? { title, body, message: body, ...rest, ...entry.payload }
					: { title, body, ...rest };

				const response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(ms("5 minutes")),
				});

				if (!response.ok) {
					const responseText = await response.clone().text();
					logger.error(
						`${url} rejected push notification: ${response.status} ${response.statusText}`,
					);
					logger.debug(
						`${url}: ${responseText.slice(0, 100)}${
							responseText.length > 100 ? "..." : ""
						}"`,
					);
					return {
						url,
						ok: false,
						error: `${response.status} ${response.statusText}`,
					};
				}
				return { url, ok: true };
			} catch (e) {
				logger.error(
					`${url} failed to send push notification: ${e.message}`,
				);
				logger.debug(e);
				return { url, ok: false, error: e.message };
			}
		});
	}
}

export function sendResultsNotification(
	searchee: SearcheeWithLabel,
	results: [ResultAssessment, TrackerName, ActionResult][],
) {
	const source = searchee.label;
	const searcheeCategory = searchee.category ?? null;
	const searcheeTags = searchee.tags ?? null;
	const searcheeTrackers = searchee.trackers ?? null;
	const searcheeLength = searchee.length;
	const searcheeInfoHash = searchee.infoHash ?? null;
	const searcheeClientHost = searchee.clientHost ?? null;
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
		const paused = notableSuccesses.every(
			([, , actionResult]) => actionResult === SaveResult.SAVED,
		)
			? true
			: notableSuccesses.some(([{ metafile }]) =>
					estimatePausedStatus(
						metafile!,
						searchee,
						(findFallback(
							notableSuccesses,
							[Decision.MATCH, Decision.MATCH_SIZE_ONLY],
							(success, decision) =>
								success[0].decision === decision &&
								success[2] === InjectionResult.SUCCESS,
						)?.[0].decision ??
							Decision.MATCH_PARTIAL) as DecisionAnyMatch,
					),
				);
		const injected = notableSuccesses.some(
			([, , actionResult]) => actionResult === InjectionResult.SUCCESS,
		);
		const performedAction = injected
			? `Injected${paused ? " (paused)" : ""}`
			: "Saved";
		const decisions = notableSuccesses.map(([{ decision }]) => decision);

		void pushNotifier.notify({
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
					clientHost: searcheeClientHost,
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

		void pushNotifier.notify({
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
					clientHost: searcheeClientHost,
					infoHash: searcheeInfoHash,
					path: searcheePath,
					source: searcheeSource,
				},
			},
		});
	}
}

export function initializePushNotifier(): void {
	const { notificationWebhookUrls } = getRuntimeConfig();
	pushNotifier = new PushNotifier(notificationWebhookUrls);
}

export async function sendTestNotification(): Promise<void> {
	await pushNotifier.notify({ body: "Test", extra: { event: Event.TEST } });
	logger.info("Sent test notification");
}
