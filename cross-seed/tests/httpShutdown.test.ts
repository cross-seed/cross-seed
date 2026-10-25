import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

// Exercise the built application, including startup's actual signal handler.
// CI builds before testing; this also verifies the deployable runtime boundary.
describe("daemon signal shutdown", () => {
	it.each(["SIGTERM", "SIGINT"] as const)(
		"drains HTTP work before database teardown on %s",
		async (signal) => {
			const dir = await mkdtemp(join(tmpdir(), "hono-signal-"));
			const root = pathToFileURL(
				join(import.meta.dirname, "../dist/"),
			).href;
			const fixture = join(dir, "daemon.mjs");
			await writeFile(
				fixture,
				`
   import {writeFile} from 'node:fs/promises';
   import {setTimeout} from 'node:timers/promises';
   const root=${JSON.stringify(root)};
   const config=await import(root+'configuration.js');config.createAppDirHierarchy();
   const logging=await import(root+'logger.js');logging.initializeLogger({verbose:false});
   const {db}=await import(root+'db.js');await db.migrate.latest();
   (await import(root+'runtimeConfig.js')).setRuntimeConfig(config.getDefaultRuntimeConfig());
   await import(root+'startup.js');
   const {createServer}=await import(root+'server.js');const server=createServer();
   server.app.post('/held',async c=>{
    console.log('HOLDING');await setTimeout(200);
    await db.raw('SELECT 1');
    await writeFile(${JSON.stringify(join(dir, "completed"))},'database still open');
    return c.text('done');
   });
   await server.listen({host:'127.0.0.1',port:0});
   console.log('READY '+server.server.address().port);
  `,
			);
			const child = spawn(process.execPath, [fixture], {
				env: { ...process.env, CONFIG_DIR: dir },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				output += String(chunk);
			});
			const exited = new Promise<{
				code: number | null;
				signal: NodeJS.Signals | null;
			}>((resolve, reject) => {
				child.once("error", reject);
				child.once("exit", (code, signal) => resolve({ code, signal }));
			});
			try {
				await vi.waitFor(() => expect(output).toMatch(/READY \d+/), {
					timeout: 10000,
				});
				const port = output.match(/READY (\d+)/)![1];
				const request = fetch(`http://127.0.0.1:${port}/held`, {
					method: "POST",
				});
				await vi.waitFor(() => expect(output).toContain("HOLDING"));
				child.kill(signal);
				expect(await (await request).text()).toBe("done");
				expect(await exited).toEqual({ code: 0, signal: null });
				expect(await readFile(join(dir, "completed"), "utf8")).toBe(
					"database still open",
				);
				await expect(
					readFile(join(dir, "daemon.json")),
				).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				if (child.exitCode === null && child.signalCode === null)
					child.kill("SIGKILL");
				await exited;
				await rm(dir, { recursive: true, force: true });
			}
		},
		15000,
	);
});
