import type { Problem } from "../problems.js";
import {
	IndexerStatus,
	getAllIndexers,
	getEnabledIndexers,
} from "../indexers.js";
import { humanReadableDate } from "../utils.js";

function problemId(suffix: string, indexerId: number | string): string {
	return `indexer:${suffix}:${indexerId}`;
}

function displayName(url: string, name: string | null): string {
	return name?.trim() || url;
}

export async function collectIndexerProblems(): Promise<Problem[]> {
	const problems: Problem[] = [];
	const indexers = await getAllIndexers();

	if (!indexers.length) {
		problems.push({
			id: "indexer:none-configured",
			severity: "error",
			summary: "No indexers configured.",
			details:
				"Add at least one indexer so cross-seed can search for releases.",
		});
		return problems;
	}

	const enabledIndexers = await getEnabledIndexers();
	if (!enabledIndexers.length) {
		problems.push({
			id: "indexer:none-enabled",
			severity: "error",
			summary: "All configured indexers are disabled.",
			details:
				"Enable at least one indexer so cross-seed can run searches.",
		});
	}

	const now = Date.now();

	for (const indexer of indexers) {
		const name = displayName(indexer.url, indexer.name);

		if (!indexer.searchCap) {
			problems.push({
				id: problemId("no-search-cap", indexer.id),
				severity: "warning",
				summary: `Indexer "${name}" does not support searching.`,
				details:
					"Update the indexer's capabilities (caps) in Prowlarr/Jackett or disable it for searching.",
			});
		}

		if (
			indexer.status === IndexerStatus.RATE_LIMITED &&
			typeof indexer.retryAfter === "number" &&
			indexer.retryAfter > now
		) {
			problems.push({
				id: problemId("rate-limited", indexer.id),
				severity: "warning",
				summary: `Indexer "${name}" is rate limited.`,
				details: `Cross-seed will retry after ${humanReadableDate(indexer.retryAfter)}.`,
			});
		}

		if (indexer.status === IndexerStatus.UNKNOWN_ERROR) {
			problems.push({
				id: problemId("unknown-error", indexer.id),
				severity: "warning",
				summary: `Indexer "${name}" recently failed.`,
				details:
					"Check logs for the underlying error and verify the indexer configuration.",
			});
		}

		if (!indexer.enabled) {
			problems.push({
				id: problemId("disabled", indexer.id),
				severity: "info",
				summary: `Indexer "${name}" is disabled.`,
				details:
					"Re-enable the indexer if you want cross-seed to include it in searches.",
			});
		}
	}

	return problems;
}
