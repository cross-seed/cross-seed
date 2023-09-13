import fetch from "node-fetch";
import { ActionResult, InjectionResult, SaveResult } from "./constants.js";
import { ResultAssessment } from "./decide.js";
import { Label, logger } from "./logger.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { Searchee } from "./searchee.js";
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
	username: string | undefined;
	password: string | undefined;

	constructor(url: string)  {
		const urlObj = new URL(url);

		if (urlObj.username && urlObj.password) {
			this.username = urlObj.username;
			this.password = urlObj.password;

			// Remove the username and password from the URL
			urlObj.username = "";
			urlObj.password = "";

			this.url = urlObj.toString();
		} else {
		this.url = url;
		}
	}

	async notify({ title = "cross-seed", body, ...rest }: PushNotification): Promise<void> {
		if (this.url) {
			const headers = new Headers();
			headers.append("Content-Type", "application/json");
		
			if (this.username && this.password) {
				const credentials = `${this.username}:${this.password}`;
				const basicAuth = "Basic " + btoa(credentials);
				headers.append("Authorization", basicAuth);
			}

			logger.verbose(`Notification request send to ${this.url}`);

			try {
				const response = await fetch(this.url, {
					method: "POST",
					headers,
					body: JSON.stringify({ title, body, ...rest }),
				});

				const responseText = await response.text();
				response.ok
					? logger.verbose(`Notifiaction server response:\n${responseText}`)
					: logger.error(`Notifiaction server error: ${response.status}, ${response.statusText}`);

			} catch (error) {
				logger.error({ message: "Failed to send push notification", error });
			}
		}
	}
}

export function sendResultsNotification(
	searchee: Searchee,
	results: [ResultAssessment, TrackerName, ActionResult][],
	source: Label.REVERSE_LOOKUP | Label.SEARCH
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
		const numTrackers = notableSuccesses.length;
		const infoHashes = notableSuccesses.map(
			([assessment]) => assessment.metafile.infoHash
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
			([assessment]) => assessment.metafile.infoHash
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
	pushNotifier.notify({ body: "Test" });
	logger.info("Sent test notification");
}
