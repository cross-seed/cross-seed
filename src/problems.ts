import { collectArrProblems } from "./arr.js";
import {
	collectClientLinkingProblems,
	collectClientProblems,
} from "./clients/TorrentClient.js";
import { collectIndexerProblems } from "./indexers.js";
import { collectDataLinkingProblems } from "./problems/linking.js";
import { collectPathProblems } from "./problems/path.js";
import { collectRecommendationProblems } from "./runtimeConfig.js";
import { collectSearcheeProblems } from "./searchee.js";

export type ProblemSeverity = "error" | "warning" | "info";

export interface ProblemMetadata {
	[key: string]: unknown;
}

export interface Problem {
	id: string;
	severity: ProblemSeverity;
	summary: string;
	details?: string;
	metadata?: ProblemMetadata;
}

export type ProblemProvider = () => Promise<Problem[]> | Problem[];

interface RegisteredProblemProvider {
	id: string;
	provider: ProblemProvider;
}

const registeredProblemProviders: RegisteredProblemProvider[] = [
	{ id: "indexers", provider: collectIndexerProblems },
	{ id: "clients", provider: collectClientProblems },
	{ id: "client-linking", provider: collectClientLinkingProblems },
	{ id: "arr", provider: collectArrProblems },
	{ id: "paths", provider: collectPathProblems },
	{ id: "linking", provider: collectDataLinkingProblems },
	{ id: "searchees", provider: collectSearcheeProblems },
	{ id: "recommendations", provider: collectRecommendationProblems },
];

function getProviderName(
	registration: RegisteredProblemProvider,
	index: number,
): string {
	return registration.id || registration.provider.name || `provider-${index}`;
}

export async function collectProblems(): Promise<Problem[]> {
	const results = await Promise.allSettled(
		registeredProblemProviders.map((registration) =>
			registration.provider(),
		),
	);

	const problems: Problem[] = [];

	results.forEach((result, index) => {
		const registration = registeredProblemProviders[index];
		if (result.status === "fulfilled") {
			for (const problem of result.value) {
				if (problem) problems.push(problem);
			}
			return;
		}

		const error = result.reason;
		const message =
			error instanceof Error ? error.message : String(error ?? "unknown");

		const providerName = getProviderName(registration, index);
		problems.push({
			id: `problem-provider-error:${providerName}`,
			severity: "error",
			summary: "Problem provider failed to collect problems.",
			details: message,
			metadata: {
				provider: providerName,
			},
		});
	});

	return problems;
}
