import type { Problem } from "../problems.js";
import { getClients } from "../clients/TorrentClient.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Action } from "../constants.js";

function createProblemId(kind: string, identifier: string): string {
	return `client:${kind}:${identifier}`;
}

export async function collectClientProblems(): Promise<Problem[]> {
	const problems: Problem[] = [];
	const runtimeConfig = getRuntimeConfig();
	const configuredClients = runtimeConfig.torrentClients ?? [];
	const clients = getClients();

	if (
		runtimeConfig.action === Action.INJECT &&
		configuredClients.length === 0
	) {
		problems.push({
			id: "client:inject-without-clients",
			severity: "error",
			summary: "Injection requires at least one configured torrent client.",
			details:
				"Add a torrent client in Settings → Download Clients or switch the action away from Inject.",
		});
		return problems;
	}

	if (configuredClients.length && clients.length === 0) {
		problems.push({
			id: "client:initialization-failed",
			severity: "error",
			summary: "Torrent clients failed to initialize.",
			details:
				"Check the configuration for typos or authentication issues, then restart cross-seed.",
		});
		return problems;
	}

	if (
		runtimeConfig.action === Action.INJECT &&
		!clients.some((client) => !client.readonly)
	) {
		problems.push({
			id: "client:inject-readonly",
			severity: "error",
			summary: "Injection is not possible when all clients are read-only.",
			details: "Mark at least one client as writable to allow injection.",
		});
	}

	const validationResults = await Promise.allSettled(
		clients.map((client) => client.validateConfig()),
	);

	validationResults.forEach((result, index) => {
		if (result.status === "fulfilled") return;

		const client = clients[index];
		const message =
			result.reason instanceof Error
				? result.reason.message
				: String(result.reason ?? "Unknown error");

		problems.push({
			id: createProblemId("validation", client.label),
			severity: "error",
			summary: `${client.label} failed validation.`,
			details: message,
			metadata: {
				clientType: client.clientType,
				clientHost: client.clientHost,
				readonly: client.readonly,
			},
		});
	});

	return problems;
}
