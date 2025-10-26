import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { MatchMode } from "../constants.js";

export function collectRecommendationProblems(): Problem[] {
    const { matchMode } = getRuntimeConfig();
    const problems: Problem[] = [];

    if (matchMode !== MatchMode.PARTIAL) {
        problems.push({
            id: "recommendation:partial-matching",
            severity: "info",
            summary: "Enable partial matching for better results",
            details:
                "Partial matching skips tiny files and improves match success. Enable it under Settings → Search & RSS when linking is available.",
            metadata: {
                recommendation: true,
            },
        });
    }

    return problems;
}
