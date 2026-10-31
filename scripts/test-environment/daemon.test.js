import { test } from "node:test";
import { runScenario } from "./scenario.js";

test(
	"fresh daemon → settings → inventory → search → hardlink/inject → disconnect recovery → restart",
	{ timeout: 60000 },
	async (context) => {
		await runScenario((message) => context.diagnostic(message));
	},
);

import { runOverlapScenario } from "./overlap.js";

test(
	"exact shared-root rejection and nested roots → injection → live rescan → restart",
	{ timeout: 60000 },
	async (context) => {
		await runOverlapScenario((message) => context.diagnostic(message));
	},
);

import { runSchedulingScenario } from "./scheduling.js";

test(
	"live HTTP/CLI scheduler changes and internal bounds survive restart",
	{ timeout: 60000 },
	async (context) => {
		await runSchedulingScenario((message) => context.diagnostic(message));
	},
);
