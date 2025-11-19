import type { Problem } from "./problems.js";
import { MatchMode } from "./constants.js";
import { omitUndefined } from "./utils/object.js";
import type { RuntimeConfig } from "../packages/shared/configSchema.js";
export type { RuntimeConfig };

let runtimeConfig: RuntimeConfig;

export function setRuntimeConfig(configObj: RuntimeConfig): void {
	runtimeConfig = configObj;
}

export function getRuntimeConfig(
	configOverride: Partial<RuntimeConfig> = {},
): RuntimeConfig {
	return {
		...runtimeConfig,
		...omitUndefined(configOverride),
	};
}

export function collectRecommendationProblems(): Problem[] {
	const { matchMode } = getRuntimeConfig();
	if (matchMode === MatchMode.PARTIAL) return [];

	return [
		{
			id: "recommendation:partial-matching",
			severity: "info",
			summary: "Enable partial matching for better results",
			details:
				"Partial matching skips tiny files and improves match success. Enable it under Settings → Search & RSS when linking is available.",
			metadata: { recommendation: true },
		},
	];
}
