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
import { errorMessage, findFallback, formatAsList, mapAsync } from "./utils.js";

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
	templateVars?: Record<string, string>;
	extra?: Record<string, unknown>;
}

function substituteTemplateValue(
	value: unknown,
	vars: Record<string, string>,
): unknown {
	if (typeof value === "string") {
		return value.replace(
			/\{(\w+)\}/g,
			(match, varName: string) => vars[varName] ?? match,
		);
	}
	if (Array.isArray(value)) {
		return value.map((item) => substituteTemplateValue(item, vars));
	}
	if (value !== null && typeof value === "object") {
		return substituteTemplateVars(value as Record<string, unknown>, vars);
	}
	return value;
}

export function substituteTemplateVars(
	obj: Record<string, unknown>,
	vars: Record<string, string>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = substituteTemplateValue(value, vars);
	}
	return result;
}

const DEFAULT_HEADERS: Record<string, string> = {
	"Content-Type": "application/json",
	"User-Agent": USER_AGENT,
};

/**
 * Merge user-supplied headers over the defaults case-insensitively, so a
 * user override like `content-type` replaces the default `Content-Type`
 * instead of both being sent.
 */
export function mergeHeaders(
	defaults: Record<string, string>,
	overrides?: Record<string, string>,
): Record<string, string> {
	const merged: Record<string, string> = { ...defaults };
	if (!overrides) return merged;
	for (const [key, value] of Object.entries(overrides)) {
		for (const existing of Object.keys(merged)) {
			if (
				existing !== key &&
				existing.toLowerCase() === key.toLowerCase()
			) {
				delete merged[existing];
			}
		}
		merged[key] = value;
	}
	return merged;
}

export class PushNotifier {
	entries: WebhookEntry[];

	constructor(entries: WebhookEntry[]) {
		this.entries = entries;
	}

	async notify({
		title = PROGRAM_NAME,
		body,
		templateVars,
		...rest
	}: PushNotification): Promise<WebhookResult[]> {
		return mapAsync(this.entries, async (entry) => {
			const isObject = typeof entry !== "string";
			const url = isObject ? entry.url : entry;
			try {
				let headers: Record<string, string> = isObject
					? mergeHeaders(DEFAULT_HEADERS, entry.headers)
					: { ...DEFAULT_HEADERS };

				let payload: Record<string, unknown> = isObject
					? { title, body, ...rest, ...entry.payload }
					: { title, body, ...rest };

				if (isObject && templateVars) {
					payload = substituteTemplateVars(payload, templateVars);
					headers = substituteTemplateVars(
						headers,
						templateVars,
					) as Record<string, string>;
				}

				let serializedPayload: string;
				try {
					serializedPayload = JSON.stringify(payload);
				} catch (e) {
					logger.error(
						`${url} has an unserializable webhook payload: ${errorMessage(e)}`,
					);
					return {
						url,
						ok: false,
						error: `Invalid payload: ${errorMessage(e)}`,
					};
				}

				const response = await fetch(url, {
					method: "POST",
					headers,
					body: serializedPayload,
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
					`${url} failed to send push notification: ${errorMessage(e)}`,
				);
				logger.debug(e);
				return { url, ok: false, error: errorMessage(e) };
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

		const result = injected ? InjectionResult.SUCCESS : SaveResult.SAVED;

		void pushNotifier.notify({
			body: `${source}: ${performedAction} ${name} on ${numTrackers} tracker${numTrackers !== 1 ? "s" : ""} by ${formatAsList(decisions, { sort: true })} from ${searcheeSource}: ${trackersListStr}`,
			templateVars: {
				source,
				performedAction,
				name,
				numTrackers: String(numTrackers),
				trackersListStr,
				searcheeSource,
				decisions: formatAsList(decisions, { sort: true }),
				trackers: trackers.join(", "),
				result: String(result),
				paused: String(paused),
				infoHashes: infoHashes.join(", "),
			},
			extra: {
				event: Event.RESULTS,
				name,
				infoHashes,
				trackers,
				source,
				result,
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
			templateVars: {
				source,
				performedAction: "Failed to inject",
				name,
				numTrackers: String(numTrackers),
				trackersListStr,
				searcheeSource,
				decisions: formatAsList(decisions, { sort: true }),
				trackers: trackers.join(", "),
				result: String(failures[0][2]),
				paused: "false",
				infoHashes: infoHashes.join(", "),
			},
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

export async function sendTestNotification(
	entries?: WebhookEntry[],
): Promise<WebhookResult[]> {
	const notifier = new PushNotifier(
		entries ?? getRuntimeConfig().notificationWebhookUrls,
	);
	const results = await notifier.notify({
		body: "Test notification from cross-seed",
		templateVars: {
			source: "TestClient",
			performedAction: "Injected",
			name: "Test.Torrent.2024.1080p.BluRay.x264",
			numTrackers: "1",
			trackersListStr: "ExampleTracker",
			searcheeSource: "torrentClient",
			decisions: "MATCH",
			trackers: "ExampleTracker",
			result: String(InjectionResult.SUCCESS),
			paused: "false",
			infoHashes: "abc123def456",
		},
		extra: { event: Event.TEST },
	});
	logger.info("Sent test notification");
	return results;
}
