import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
	backupDatabase,
	checkDatabase,
	exportSettings,
	importSettings,
	readSettings,
	setSetting,
	unsetSetting,
} from "../src/configCli.js";

let connection: DatabaseSync | undefined;
afterEach(() => {
	connection?.close();
	connection = undefined;
});
async function fixture(
	raw: string = '{"dataDirs":["/unavailable"],"apiKey":"123456789012345678901234"}',
) {
	const directory = await mkdtemp(join(tmpdir(), "cross-seed-config-cli-"));
	const filename = join(directory, "cross-seed.db");
	connection = new DatabaseSync(filename);
	connection.exec(
		"PRAGMA journal_mode=WAL; CREATE TABLE settings(apikey TEXT, settings_json TEXT); CREATE TABLE indexer(id INTEGER, apikey TEXT); INSERT INTO indexer VALUES(1,'indexer-secret'); CREATE TABLE history(value TEXT); INSERT INTO history VALUES('keep me');",
	);
	connection
		.prepare("INSERT INTO settings(settings_json) VALUES(?)")
		.run(raw);
	return { directory, filename };
}

describe("offline settings and database recovery CLI", () => {
	it("reads invalid overrides and repairs one setting without checking source availability or changing unrelated state", async () => {
		const { filename } = await fixture(
			'{"maxDataDepth":0,"dataDirs":["/unavailable"]}',
		);
		expect((await readSettings(filename)).maxDataDepth).toBe(0);
		await setSetting(filename, "maxDataDepth", 3);
		expect(await readSettings(filename)).toMatchObject({
			maxDataDepth: 3,
			dataDirs: ["/unavailable"],
		});
		expect(
			connection!.prepare("SELECT value FROM history").get()?.value,
		).toBe("keep me");
		expect(
			connection!.prepare("SELECT apikey FROM indexer").get()?.apikey,
		).toBe("indexer-secret");
	});
	it("rejects unknown keys, invalid JSON values, and legacy indexer writes without altering settings", async () => {
		const { filename } = await fixture();
		const before = await readSettings(filename);
		await expect(setSetting(filename, "dataDir", [])).rejects.toThrow(
			"Unknown setting",
		);
		await expect(setSetting(filename, "maxDataDepth", 0)).rejects.toThrow();
		await expect(
			setSetting(filename, "dataDirs", "/media"),
		).rejects.toThrow();
		await expect(setSetting(filename, "torznab", [])).rejects.toThrow(
			"Manage indexers",
		);
		expect(await readSettings(filename)).toEqual(before);
	});
	it("removes an invalid override and restores the default", async () => {
		const { filename } = await fixture(
			'{"maxDataDepth":0,"unknownOption":true}',
		);
		await expect(unsetSetting(filename, "maxDataDepth")).rejects.toThrow();
		const repair = join(
			(await import("node:path")).dirname(filename),
			"repair.json",
		);
		await writeFile(repair, JSON.stringify({ maxDataDepth: 3 }));
		await importSettings(filename, repair);
		await unsetSetting(filename, "maxDataDepth");
		expect((await readSettings(filename, true)).maxDataDepth).toBe(2);
	});
	it("exports private JSON without overwriting, and round trips settings while preserving indexers and history", async () => {
		const { filename, directory } = await fixture();
		const exported = join(directory, "settings.json");
		const before = await readSettings(filename);
		await exportSettings(filename, exported);
		if (process.platform !== "win32")
			expect((await stat(exported)).mode & 0o777).toBe(0o600);
		await expect(exportSettings(filename, exported)).rejects.toThrow();
		await setSetting(filename, "dataDirs", []);
		await importSettings(filename, exported);
		expect(await readSettings(filename)).toEqual(before);
		expect(
			connection!.prepare("SELECT count(*) AS n FROM indexer").get()?.n,
		).toBe(1);
		expect(
			connection!.prepare("SELECT value FROM history").get()?.value,
		).toBe("keep me");
	});
	it("replaces malformed settings JSON using validated import and rolls back invalid imports", async () => {
		const { filename, directory } = await fixture("{broken");
		const input = join(directory, "repair.json");
		await writeFile(input, '{"dataDirs":[],"maxDataDepth":3}');
		await importSettings(filename, input);
		expect((await readSettings(filename)).maxDataDepth).toBe(3);
		const before = await readSettings(filename);
		await writeFile(input, '{"maxDataDepth":0}');
		await expect(importSettings(filename, input)).rejects.toThrow();
		await writeFile(input, '{"typo":true}');
		await expect(importSettings(filename, input)).rejects.toThrow();
		await writeFile(input, "[]");
		await expect(importSettings(filename, input)).rejects.toThrow();
		await writeFile(input, '{"torznab":["http://localhost:9696/1/api"]}');
		await expect(importSettings(filename, input)).rejects.toThrow(
			"Legacy torznab URLs cannot be imported",
		);
		expect(await readSettings(filename)).toEqual(before);
	});
	it("backs up committed WAL data consistently and refuses to overwrite any destination", async () => {
		const { filename, directory } = await fixture();
		const destination = join(directory, "backup.db");
		connection!
			.prepare("INSERT INTO history VALUES(?)")
			.run("committed in WAL");
		await backupDatabase(filename, destination);
		await checkDatabase(destination);
		const restored = new DatabaseSync(destination, { readOnly: true });
		try {
			expect(
				restored.prepare("SELECT value FROM history").all(),
			).toHaveLength(2);
		} finally {
			restored.close();
		}
		if (process.platform !== "win32")
			expect((await stat(destination)).mode & 0o777).toBe(0o600);
		await expect(backupDatabase(filename, destination)).rejects.toThrow();
		await expect(backupDatabase(filename, filename)).rejects.toThrow();
		await checkDatabase(filename);
	});
	it("detects corruption without overwriting the source, and does not create a missing database", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "cross-seed-corrupt-cli-"),
		);
		const filename = join(directory, "corrupt.db");
		const original = Buffer.from("not a sqlite database".repeat(200));
		await writeFile(filename, original);
		await expect(checkDatabase(filename)).rejects.toThrow();
		expect(await readFile(filename)).toEqual(original);
		const missing = join(directory, "missing.db");
		await expect(readSettings(missing)).rejects.toThrow();
		await expect(setSetting(missing, "dataDirs", [])).rejects.toThrow();
		await expect(stat(missing)).rejects.toThrow();
	});
});
