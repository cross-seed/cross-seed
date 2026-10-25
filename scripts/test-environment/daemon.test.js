import { test } from "node:test";
import { runScenario } from "./scenario.js";

test(
	"fresh daemon → settings → inventory → search → hardlink/inject → disconnect recovery → restart",
	{ timeout: 60000 },
	async (context) => {
		await runScenario((message) => context.diagnostic(message));
	},
);
