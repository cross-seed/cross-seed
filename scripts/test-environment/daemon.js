import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const entrypoint = fileURLToPath(
	new URL("../../cross-seed/dist/cmd.js", import.meta.url),
);

export async function eventually(description, check, timeout = 15000) {
	const until = Date.now() + timeout;
	let lastError;
	while (Date.now() < until) {
		try {
			const value = await check();
			if (value) return value;
		} catch (error) {
			lastError = error;
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${description}`, {
		cause: lastError,
	});
}

export async function createEnvironment() {
	const directory = await mkdtemp(join(tmpdir(), "cross-seed-environment-"));
	const configDir = join(directory, "config");
	const dataDir = join(directory, "data");
	const linkDir = join(directory, "links");
	await Promise.all([configDir, dataDir, linkDir].map((path) => mkdir(path)));
	let child;
	let exited;
	let base;
	let cookie;
	let output = "";
	async function stop() {
		if (!child) return;
		child.kill("SIGTERM");
		const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
		try {
			const result = await exited;
			assert.deepEqual(result, { code: 0, signal: null }, output);
		} finally {
			clearTimeout(timeout);
			child = undefined;
		}
	}
	async function start() {
		assert.ok(!child, "Stop the previous daemon before restarting");
		await readFile(entrypoint); // Fail immediately with the build command's missing-file error.
		const socket = createServer();
		await new Promise((resolve, reject) => {
			socket.once("error", reject);
			socket.listen(0, "127.0.0.1", resolve);
		});
		const port = socket.address().port;
		await new Promise((resolve) => socket.close(resolve));
		base = `http://127.0.0.1:${port}`;
		child = spawn(
			process.execPath,
			[
				entrypoint,
				"daemon",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
			],
			{
				env: {
					...process.env,
					CONFIG_DIR: configDir,
					NODE_ENV: "test",
					CROSS_SEED_DEV_LOGIN: "false",
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		exited = new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => resolve({ code, signal }));
		});
		void exited.catch(() => undefined);
		child.stdout.on("data", (data) => {
			output = (output + data).slice(-128000);
		});
		child.stderr.on("data", (data) => {
			output = (output + data).slice(-128000);
		});
		await eventually("daemon readiness", async () => {
			assert.equal(child.exitCode, null, output);
			return (await request("/api/ping")).status === 200;
		});
	}
	function request(path, options = {}) {
		return fetch(`${base}${path}`, {
			...options,
			headers: { ...(cookie ? { cookie } : {}), ...options.headers },
			signal: AbortSignal.timeout(20000),
		});
	}
	async function trpc(procedure, input, mutation = false) {
		const query =
			!mutation && input !== undefined
				? `?input=${encodeURIComponent(JSON.stringify(input))}`
				: "";
		const response = await request(`/api/trpc/${procedure}${query}`, {
			method: mutation ? "POST" : "GET",
			headers: mutation ? { "content-type": "application/json" } : {},
			...(mutation ? { body: JSON.stringify(input ?? null) } : {}),
		});
		const session = response.headers.getSetCookie()[0];
		if (session) cookie = session.split(";")[0];
		const body = await response.json();
		assert.ok(
			response.ok && body.result,
			`${procedure}: ${JSON.stringify(body)}\n${output}`,
		);
		return body.result.data;
	}
	return {
		directory,
		configDir,
		dataDir,
		linkDir,
		start,
		stop,
		trpc,
		request,
		cli: (...args) =>
			promisify(execFile)(process.execPath, [entrypoint, ...args], {
				env: { ...process.env, CONFIG_DIR: configDir },
				timeout: 15000,
			}),
		get output() {
			return output;
		},
		async close() {
			try {
				await stop();
			} finally {
				await rm(directory, {
					recursive: true,
					force: true,
					maxRetries: 3,
				});
			}
		},
	};
}
