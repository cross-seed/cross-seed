import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { USER_AGENT } from "../constants.js";

type ArrKind = "Sonarr" | "Radarr";

function sanitizeDisplayUrl(url: URL): string {
	return `${url.origin}${url.pathname}`;
}

function problemId(
	kind: ArrKind,
	category: string,
	index: number,
): string {
	return `arr:${kind.toLowerCase()}:${category}:${index}`;
}

async function checkArrUrl(
	rawUrl: string,
	index: number,
	kind: ArrKind,
): Promise<Problem[]> {
	const problems: Problem[] = [];
	let parsedUrl: URL;

	try {
		parsedUrl = new URL(rawUrl);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error ?? "Unknown error");
		problems.push({
			id: problemId(kind, "invalid-url", index),
			severity: "error",
			summary: `${kind} URL ${index + 1} is invalid.`,
			details: message,
		});
		return problems;
	}

	const displayUrl = sanitizeDisplayUrl(parsedUrl);

	if (!parsedUrl.pathname.endsWith("/api")) {
		problems.push({
			id: problemId(kind, "missing-api-path", index),
			severity: "error",
			summary: `${kind} URL must end with "/api".`,
			details: `Update ${displayUrl} so the path ends with /api.`,
		});
	}

	const apiKey = parsedUrl.searchParams.get("apikey");
	if (!apiKey) {
		problems.push({
			id: problemId(kind, "missing-apikey", index),
			severity: "error",
			summary: `${kind} URL is missing an apikey parameter.`,
			details: `Add ?apikey=<KEY> (or &apikey when other parameters exist) to ${displayUrl}.`,
		});
		return problems;
	}

	try {
		const response = await fetch(parsedUrl, {
			signal: AbortSignal.timeout(30_000),
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) {
			problems.push({
				id: problemId(kind, "http-error", index),
				severity: "error",
				summary: `${kind} at ${displayUrl} responded with ${response.status}.`,
				details: `Status text: ${response.statusText || "Unknown status"}.`,
			});
			return problems;
		}

		try {
			const body = (await response.json()) as { current?: unknown };
			if (typeof body?.current !== "string" || body.current.length === 0) {
				problems.push({
					id: problemId(kind, "unexpected-response", index),
					severity: "warning",
					summary: `${kind} at ${displayUrl} returned an unexpected response.`,
					details:
						"cross-seed expected a version string from /api but received something else.",
				});
			}
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unable to parse response from Arr instance.";
			problems.push({
				id: problemId(kind, "invalid-json", index),
				severity: "warning",
				summary: `${kind} at ${displayUrl} returned non-JSON data.`,
				details: message,
			});
		}
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error ?? "Unknown error");
		const isAbort =
			typeof error === "object" && error !== null && "name" in error &&
				(error as { name?: string }).name === "TimeoutError";
		problems.push({
			id: problemId(kind, "network-error", index),
			severity: "error",
			summary: `${kind} at ${displayUrl} could not be reached.`,
			details: isAbort
				? "The request timed out after 30 seconds."
				: message,
		});
	}

	return problems;
}

export async function collectArrProblems(): Promise<Problem[]> {
	const { sonarr = [], radarr = [] } = getRuntimeConfig();
	const problems: Problem[] = [];
	const hasSonarr = Array.isArray(sonarr) && sonarr.length > 0;
	const hasRadarr = Array.isArray(radarr) && radarr.length > 0;

	if (!hasSonarr && !hasRadarr) {
		problems.push({
			id: "arr:not-configured",
			severity: "info",
			summary: "Sonarr/Radarr integrations are not configured.",
			details:
				"Configure Arr URLs if you want cross-seed to sync release history or send notifications.",
		});
		return problems;
	}

	await Promise.all([
		...sonarr.map((url, index) => checkArrUrl(url, index, "Sonarr")),
		...radarr.map((url, index) => checkArrUrl(url, index, "Radarr")),
	]).then((results) => {
		for (const arrProblems of results) {
			problems.push(...arrProblems);
		}
	});

	return problems;
}
