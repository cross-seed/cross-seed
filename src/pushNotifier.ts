import fetch from "node-fetch";
import { logger } from "./logger";
import { getRuntimeConfig } from "./runtimeConfig";

export let pushNotifier: PushNotifier;

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
			});
		}
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
