import { collectIndexerProblems } from "./problems/indexers.js";
import { collectClientProblems } from "./problems/clients.js";
import { collectArrProblems } from "./problems/arr.js";
import { collectPathProblems } from "./problems/paths.js";
import { collectRecommendationProblems } from "./problems/recommendations.js";
import { collectSearcheeProblems } from "./problems/searchees.js";

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
    { id: "arr", provider: collectArrProblems },
    { id: "paths", provider: collectPathProblems },
    { id: "searchees", provider: collectSearcheeProblems },
    { id: "recommendations", provider: collectRecommendationProblems },
];

function providerName(registration: RegisteredProblemProvider, index: number) {
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

		problems.push({
			id: `problem-provider-error:${providerName(registration, index)}`,
			severity: "error",
			summary: "Problem provider failed to collect problems.",
			details: message,
			metadata: {
				provider: providerName(registration, index),
			},
		});
	});

	return problems;
}
