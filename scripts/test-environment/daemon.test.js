import { test } from "node:test";
import { runScenario } from "./scenario.js";
import { runStartupScenario } from "./startup.js";
import { runWatcherScenario } from "./watcher.js";
import { runAnnounceScenario } from "./announce.js";

test(
	"announce identities persist and cached retries survive changed URLs and restart",
	{ timeout: 60000 },
	async (context) => {
		await runAnnounceScenario((message) => context.diagnostic(message));
	},
);

test(
	"Linux watcher exceptions preserve the daemon and recover inventory",
	{
		timeout: 60000,
		skip: process.platform !== "linux" || process.getuid?.() === 0,
	},
	async (context) => {
		await runWatcherScenario((message) => context.diagnostic(message));
	},
);

test(
	"saved startup settings and explicit CLI precedence",
	{ timeout: 60000 },
	async (context) => {
		await runStartupScenario((message) => context.diagnostic(message));
	},
);

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
