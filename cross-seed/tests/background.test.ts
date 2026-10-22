import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
// Run the actual helper in a child process: a fatal error must not take down
// the test runner, and these tests must work before the application is built.
const source = await readFile(
	new URL("../src/utils/background.ts", import.meta.url),
	"utf8",
);
const { outputText } = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
});
const helperUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;

function run(script: string) {
	return execFileAsync(process.execPath, [
		"--input-type=module",
		"--eval",
		`import { runInBackground } from ${JSON.stringify(helperUrl)};\n${script}`,
	]);
}

describe("intentional background tasks", () => {
	it("does not block the caller and allows work to finish", async () => {
		const { stdout } = await run(`
			runInBackground(new Promise(resolve => setTimeout(() => {
				console.log('finished');
				resolve();
			}, 10)));
			console.log('caller returned');
		`);
		expect(stdout.trim().split("\n")).toEqual([
			"caller returned",
			"finished",
		]);
	});

	it("unexpected rejection terminates the process with the original error", async () => {
		await expect(
			run(
				`runInBackground(Promise.reject(new Error('background bug')));`,
			),
		).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining("Error: background bug") as unknown,
		});
	});

	it("allows a task to recover from an expected error", async () => {
		const { stdout } = await run(`
			runInBackground(Promise.reject(new Error('expected')).catch(() => {
				console.log('recovered');
			}));
		`);
		expect(stdout.trim()).toBe("recovered");
	});
});
