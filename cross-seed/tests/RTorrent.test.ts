import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "xmlrpc";
import { searcheeFactory } from "./factories/searchee.js";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-rtorrent-tests-"));

type RTorrentEnv = {
	db: typeof import("../src/db.js").db;
	RTorrent: typeof import("../src/clients/RTorrent.js").default;
	Decision: typeof import("../src/constants.js").Decision;
	InjectionResult: typeof import("../src/constants.js").InjectionResult;
	Metafile: typeof import("../src/parseTorrent.js").Metafile;
};

type XmlRpcCallback = (error: Error | null, value?: unknown) => void;

let currentDb: RTorrentEnv["db"] | undefined;

async function createEnv(
	overrides: { skipRecheck?: boolean } = {},
): Promise<RTorrentEnv> {
	const configDir = await mkdtemp(join(TEST_ROOT, "config-"));
	process.env.CONFIG_DIR = configDir;
	vi.resetModules();

	const { db } = await import("../src/db.js");
	const { createAppDirHierarchy, getDefaultRuntimeConfig } =
		await import("../src/configuration.js");
	const { initializeLogger } = await import("../src/logger.js");
	const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
	const { Decision, InjectionResult } = await import("../src/constants.js");
	const { Metafile } = await import("../src/parseTorrent.js");
	const { default: RTorrent } = await import("../src/clients/RTorrent.js");

	createAppDirHierarchy();
	initializeLogger({ verbose: false });
	setRuntimeConfig({
		...getDefaultRuntimeConfig(),
		skipRecheck: overrides.skipRecheck ?? true,
	});
	currentDb = db;

	return {
		db,
		RTorrent,
		Decision,
		InjectionResult,
		Metafile,
	};
}

function makeMeta(Metafile: RTorrentEnv["Metafile"]) {
	return new Metafile({
		info: {
			name: Buffer.from("file.mkv"),
			"piece length": 32768,
			pieces: Buffer.alloc(20),
			length: 1000,
			private: 1,
		},
	});
}

function stringLoadParams(args: unknown[]): string[] {
	return args.filter((arg): arg is string => typeof arg === "string");
}

function installXmlRpc(
	client: InstanceType<RTorrentEnv["RTorrent"]>,
	infoHash: string,
	options: { checkHashError?: Error } = {},
) {
	let loaded = false;
	return vi.spyOn(client.client, "methodCall").mockImplementation(((
		method: string,
		_params: unknown[],
		callback: XmlRpcCallback,
	) => {
		if (method === "download_list") {
			callback(null, loaded ? [infoHash] : []);
			return;
		}
		if (method === "load.raw" || method === "load.raw_start") {
			loaded = true;
			callback(null, 0);
			return;
		}
		if (method === "d.pause") {
			callback(null, 0);
			return;
		}
		if (method === "d.check_hash") {
			if (options.checkHashError) {
				callback(options.checkHashError);
				return;
			}
			callback(null, 0);
			return;
		}
		callback(new Error(`unexpected XML-RPC method: ${method}`));
	}) as Client["methodCall"]);
}

function loadCalls(methodCall: ReturnType<typeof installXmlRpc>) {
	return methodCall.mock.calls.filter(
		([method]) => method === "load.raw" || method === "load.raw_start",
	);
}

describe.sequential("RTorrent inject hash check", () => {
	afterEach(async () => {
		await currentDb?.destroy();
		currentDb = undefined;
		delete process.env.CONFIG_DIR;
	});

	it("loads a full match with load.raw_start and does not hash-check", async () => {
		const env = await createEnv();
		const meta = makeMeta(env.Metafile);
		const client = new env.RTorrent(
			"http://localhost/RPC2",
			"localhost",
			0,
			false,
		);
		const methodCall = installXmlRpc(client, meta.infoHash);
		const resumeSpy = vi
			.spyOn(client, "resumeInjection")
			.mockResolvedValue(undefined);

		const result = await client.inject(
			meta,
			searcheeFactory({ name: meta.name }),
			env.Decision.MATCH,
			{
				onlyCompleted: true,
				destinationDir: join(TEST_ROOT, "dest"),
			},
		);

		expect(result).toBe(env.InjectionResult.SUCCESS);
		const loads = loadCalls(methodCall);
		expect(loads).toHaveLength(1);
		expect(loads[0][0]).toBe("load.raw_start");
		expect(stringLoadParams(loads[0][1])).not.toEqual(
			expect.arrayContaining([expect.stringContaining("check_hash")]),
		);
		expect(methodCall.mock.calls.map(([method]) => method)).not.toContain(
			"d.check_hash",
		);
		expect(resumeSpy).not.toHaveBeenCalled();
	});

	it("hash-checks after load.raw for a partial match, not as a load parameter", async () => {
		const env = await createEnv();
		const meta = makeMeta(env.Metafile);
		const client = new env.RTorrent(
			"http://localhost/RPC2",
			"localhost",
			0,
			false,
		);
		const methodCall = installXmlRpc(client, meta.infoHash);
		const resumeSpy = vi
			.spyOn(client, "resumeInjection")
			.mockResolvedValue(undefined);

		const result = await client.inject(
			meta,
			searcheeFactory({ name: meta.name }),
			env.Decision.MATCH_PARTIAL,
			{
				onlyCompleted: true,
				destinationDir: join(TEST_ROOT, "dest"),
			},
		);

		expect(result).toBe(env.InjectionResult.SUCCESS);
		const loads = loadCalls(methodCall);
		expect(loads).toHaveLength(1);
		expect(loads[0][0]).toBe("load.raw");
		expect(stringLoadParams(loads[0][1])).not.toEqual(
			expect.arrayContaining([expect.stringContaining("check_hash")]),
		);
		expect(stringLoadParams(loads[0][1])).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^d\.directory_base\.set="/),
				'd.custom1.set="cross-seed"',
			]),
		);

		const methods = methodCall.mock.calls.map(([method]) => method);
		expect(methods).toContain("d.pause");
		expect(methods).toContain("d.check_hash");
		expect(methods.indexOf("load.raw")).toBeLessThan(
			methods.indexOf("d.check_hash"),
		);
		expect(resumeSpy).toHaveBeenCalledOnce();
	});

	it("still succeeds and resumes if the post-load hash check fails", async () => {
		const env = await createEnv();
		const meta = makeMeta(env.Metafile);
		const client = new env.RTorrent(
			"http://localhost/RPC2",
			"localhost",
			0,
			false,
		);
		installXmlRpc(client, meta.infoHash, {
			checkHashError: new Error("Could not find info-hash."),
		});
		const resumeSpy = vi
			.spyOn(client, "resumeInjection")
			.mockResolvedValue(undefined);

		const result = await client.inject(
			meta,
			searcheeFactory({ name: meta.name }),
			env.Decision.MATCH_PARTIAL,
			{
				onlyCompleted: true,
				destinationDir: join(TEST_ROOT, "dest"),
			},
		);

		expect(result).toBe(env.InjectionResult.SUCCESS);
		expect(resumeSpy).toHaveBeenCalledOnce();
	});

	it("hash-checks after load when skipRecheck is disabled", async () => {
		const env = await createEnv({ skipRecheck: false });
		const meta = makeMeta(env.Metafile);
		const client = new env.RTorrent(
			"http://localhost/RPC2",
			"localhost",
			0,
			false,
		);
		const methodCall = installXmlRpc(client, meta.infoHash);
		vi.spyOn(client, "resumeInjection").mockResolvedValue(undefined);

		const result = await client.inject(
			meta,
			searcheeFactory({ name: meta.name }),
			env.Decision.MATCH,
			{
				onlyCompleted: true,
				destinationDir: join(TEST_ROOT, "dest"),
			},
		);

		expect(result).toBe(env.InjectionResult.SUCCESS);
		const loads = loadCalls(methodCall);
		expect(loads[0][0]).toBe("load.raw");
		expect(methodCall.mock.calls.map(([method]) => method)).toContain(
			"d.check_hash",
		);
	});
});
