import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Accept a standalone executable, or a runtime followed by its CLI entrypoint.
// With no arguments, exercise the locally built Node application.
const command = process.argv.slice(2);
if (!command.length)
	command.push(process.execPath, resolve("cross-seed/dist/cmd.js"));
const directory = await mkdtemp(join(tmpdir(), "cross-seed-runtime-smoke-"));
const socket = createServer();
await new Promise((resolve, reject) => {
	socket.once("error", reject);
	socket.listen(0, "127.0.0.1", resolve);
});
const { port } = socket.address();
await new Promise((resolve, reject) =>
	socket.close((error) => (error ? reject(error) : resolve())),
);
const apiKey = "runtime-smoke-api-key-123456789";
await writeFile(
	join(directory, "config.js"),
	`module.exports = ${JSON.stringify({ apiKey, action: "save", useClientTorrents: false, outputDir: join(directory, "output") })};\n`,
);
const child = spawn(
	command[0],
	[
		...command.slice(1),
		"daemon",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--base-path",
		"/cross-seed",
	],
	{
		env: { ...process.env, CONFIG_DIR: directory },
		stdio: ["ignore", "pipe", "pipe"],
	},
);
let output = "";
child.stdout.on("data", (chunk) => {
	output = (output + chunk).slice(-65536);
});
child.stderr.on("data", (chunk) => {
	output = (output + chunk).slice(-65536);
});
const exited = new Promise((resolve, reject) => {
	child.once("error", reject);
	child.once("exit", (code, signal) => resolve({ code, signal }));
});
// Startup may fail before the first HTTP request completes.
void exited.catch(() => undefined);
const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
deadline.unref();
const base = `http://127.0.0.1:${port}/cross-seed`;
const request = (path, options = {}) =>
	fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(2000) });
try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error("Daemon exited during startup");
		try {
			const response = await request("/api/ping");
			assert.equal(response.status, 200);
			assert.equal(await response.text(), "OK");
			ready = true;
			break;
		} catch {
			await delay(100);
		}
	}
	assert.ok(ready, "Daemon did not become ready");
	assert.equal((await request("/api/status")).status, 401);
	assert.equal((await request(`/api/status?apikey=${apiKey}`)).status, 200);
	const page = await request("/", { headers: { accept: "text/html" } });
	assert.equal(page.status, 200);
	assert.match(await page.text(), /<html/);
	const invalid = await request("/api/announce", {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": apiKey },
		body: "{}",
	});
	assert.equal(invalid.status, 400);
	const descriptor = JSON.parse(
		await readFile(join(directory, "daemon.json"), "utf8"),
	);
	assert.equal(descriptor.url, `${base}/api/trpc`);
	child.kill("SIGTERM");
	const result = await exited;
	// Windows terminates the process directly rather than delivering POSIX signals.
	if (process.platform !== "win32") {
		assert.deepEqual(result, { code: 0, signal: null });
		await assert.rejects(readFile(join(directory, "daemon.json")), {
			code: "ENOENT",
		});
	}
	console.log(
		"Runtime smoke passed: daemon startup, HTTP auth/validation, embedded UI, base path, CLI discovery, and shutdown",
	);
} catch (error) {
	console.error(output);
	throw error;
} finally {
	clearTimeout(deadline);
	if (child.exitCode === null && child.signalCode === null)
		child.kill("SIGKILL");
	await exited.catch(() => undefined);
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 100,
	});
}
