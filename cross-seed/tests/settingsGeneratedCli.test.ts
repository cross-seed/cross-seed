import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let filename: string;
let cli: typeof import("../src/configCli.js");
let output: unknown[];
beforeEach(async () => {
	process.env.CONFIG_DIR = await mkdtemp(
		join(tmpdir(), "generated-settings-cli-"),
	);
	filename = join(process.env.CONFIG_DIR, "cross-seed.db");
	vi.resetModules();
	cli = await import("../src/configCli.js");
	const db = new DatabaseSync(filename);
	db.exec(
		"CREATE TABLE settings (apikey TEXT, settings_json TEXT); INSERT INTO settings VALUES (NULL, '{}')",
	);
	db.close();
	output = [];
	vi.spyOn(console, "log").mockImplementation((value: unknown) => {
		output.push(value);
	});
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.CONFIG_DIR;
});
async function command(argv: string[]) {
	const cmd = cli.createConfigCommand(filename, argv);
	cmd.exitOverride();
	for (const command of [cmd, ...cmd.commands]) {
		command.configureOutput({
			writeErr: () => undefined,
			writeOut: () => undefined,
		});
	}
	await cmd.parseAsync(argv, { from: "user" });
}
it("parses typed number, boolean, array and optional flags and emits machine-readable get output", async () => {
	await command([
		"set",
		"--max-data-depth",
		"4",
		"--verbose",
		"--data-dirs",
		"/missing/one",
		"/missing/two",
		"--torrent-dir",
		"/missing/torrents",
	]);
	expect(await cli.readSettings(filename)).toMatchObject({
		maxDataDepth: 4,
		verbose: true,
		dataDirs: ["/missing/one", "/missing/two"],
		torrentDir: "/missing/torrents",
	});
	await command(["set", "--no-verbose"]);
	expect((await cli.readSettings(filename, true)).verbose).toBe(false);
	await command(["get", "maxDataDepth"]);
	expect(output.at(-1)).toBe("4");
	await command(["unset", "torrentDir"]);
	expect((await cli.readSettings(filename, true)).torrentDir).toBeUndefined();
});
it("supports JSON input without coercing invalid types or ignoring unknown settings", async () => {
	await command([
		"set",
		"--json",
		JSON.stringify({
			maxDataDepth: 3,
			dataDirs: [],
			useClientTorrents: false,
		}),
	]);
	const before = await readFile(filename);
	for (const value of [
		{ maxDataDepth: "4" },
		{ dataDirs: "/media" },
		{ unknownOption: true },
		{ maxDataDepth: 0 },
	]) {
		await expect(
			command(["set", "--json", JSON.stringify(value)]),
		).rejects.toThrow();
	}
	await expect(command(["set", "--not-a-setting", "true"])).rejects.toThrow();
	expect(await readFile(filename)).toEqual(before);
});
it("generates setting flags from the runtime schema and supports show defaults", async () => {
	const cmd = cli.createConfigCommand(filename);
	const help = cmd.commands
		.find((c) => c.name() === "set")!
		.helpInformation();
	expect(help).toContain("--max-data-depth");
	expect(help).toContain("--data-dirs");
	expect(help).toContain("Automatic search interval, in milliseconds.");
	expect(help).not.toContain("--torznab");
	await command(["show", "--effective"]);
	expect(JSON.parse(String(output.at(-1)))).toMatchObject({
		maxDataDepth: 2,
		verbose: false,
	});
});

it("retains typed blocklist/client flags with semantic validation and normalization", async () => {
	const hash = "Ab".repeat(20);
	const client = "rtorrent:readonly:scgi:///run/test.sock";
	await command([
		"set",
		"--block-list",
		`infoHash:${hash}`,
		"--torrent-clients",
		client,
	]);
	const before = await cli.readSettings(filename);
	expect(before).toMatchObject({
		blockList: [`infoHash:${hash.toLowerCase()}`],
		torrentClients: [client],
	});
	for (const flags of [
		["--block-list", "nameRegex:["],
		["--torrent-clients", "nonsense"],
	]) {
		await expect(command(["set", ...flags])).rejects.toThrow();
		expect(await cli.readSettings(filename)).toEqual(before);
	}
});

it("writes generated help with literal newlines rather than JSON string quoting", () => {
	const chunks: string[] = [];
	const stdout = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk) => {
			chunks.push(String(chunk));
			return true;
		});
	try {
		const cmd = cli.createConfigCommand(filename);
		cmd.commands.find((command) => command.name() === "set")!.outputHelp();
	} finally {
		stdout.mockRestore();
	}
	const help = chunks.join("");
	expect(help).toContain("\nOptions:\n");
	expect(help).toContain("--max-data-depth");
	expect(help).not.toContain("\\n");
	expect(help.trimStart()).not.toMatch(/^"/);
});

it("reports database corruption with recovery guidance and failure exit status", () => {
	const exitCode = process.exitCode;
	try {
		cli.reportConfigError(new Error("database disk image is malformed"));
		expect(process.exitCode).toBe(1);
		const messages = vi
			.mocked(console.error)
			.mock.calls.map((call) => String(call[0]))
			.join("\n");
		expect(messages).toContain("database disk image is malformed");
		expect(messages).toContain("Stop cross-seed");
		expect(messages).toContain("Do not delete the database");
		expect(messages).toContain("No automatic repair has been attempted");
		expect(messages).not.toContain(" at ");
	} finally {
		process.exitCode = exitCode;
	}
});
