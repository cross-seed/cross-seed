import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("rejects void promises and async callbacks in synchronous APIs", async () => {
	const eslint = new ESLint({
		cwd: fileURLToPath(new URL("..", import.meta.url)),
	});
	const results = await eslint.lintText(
		`void Promise.resolve();
		setTimeout(async () => { await Promise.resolve(); }, 0);`,
		{ filePath: "src/utils/background.ts" },
	);
	const rules = results.flatMap((result) =>
		result.messages.map((message) => message.ruleId),
	);
	expect(rules).toContain("@typescript-eslint/no-floating-promises");
	expect(rules).toContain("@typescript-eslint/no-misused-promises");
}, 15000);
