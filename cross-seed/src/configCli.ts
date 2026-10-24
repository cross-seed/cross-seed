import { Command } from "commander";
import { constants } from "node:fs";
import { access, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
	appDir,
	getDefaultRuntimeConfig,
	stripDefaults,
} from "./configuration.js";
import { RUNTIME_CONFIG_SCHEMA } from "./configSchema.js";

const recoveryAdvice =
	"Stop cross-seed and preserve cross-seed.db and any -wal/-shm files together before recovery. " +
	"Restore a known-good full database backup with the daemon stopped. Do not delete the database: it contains settings, indexers, users, and search history. " +
	"A settings JSON export is not a full database backup. No automatic repair has been attempted.";

export function databasePath(): string {
	return join(appDir(), "cross-seed.db");
}

// Only absence (or a dead owner) selects offline recovery. A live daemon's
// authentication, validation, timeout, or transport error must never become a
// direct SQLite write: a failed response may follow a successful mutation.
async function daemonRequest(
	filename: string,
	procedure: string,
	input?: unknown,
): Promise<unknown> {
	let raw: string;
	try {
		raw = await readFile(join(dirname(filename), "daemon.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return undefined;
		throw error;
	}
	const descriptor = JSON.parse(raw) as {
		pid: number;
		url: string | null;
		token: string;
	};
	if (
		!Number.isSafeInteger(descriptor.pid) ||
		descriptor.pid <= 0 ||
		(descriptor.url !== null && typeof descriptor.url !== "string") ||
		typeof descriptor.token !== "string" ||
		!descriptor.token
	)
		throw new Error(
			"Invalid daemon discovery file; stop the daemon before offline recovery.",
		);
	try {
		process.kill(descriptor.pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return undefined;
		throw error;
	}
	if (descriptor.url === null)
		throw new Error(
			"The daemon is running with HTTP disabled. Stop it before using offline settings recovery.",
		);
	const response = await fetch(
		`${descriptor.url.replace(/\/$/, "")}/${procedure}`,
		{
			method: input === undefined ? "GET" : "POST",
			headers: {
				authorization: `Bearer ${descriptor.token}`,
				"content-type": "application/json",
			},
			body: input === undefined ? undefined : JSON.stringify(input),
			signal: AbortSignal.timeout(10000),
			redirect: "error",
		},
	);
	const envelope = (await response.json()) as {
		result?: { data?: unknown };
		error?: { message?: string };
	};
	if (
		!response.ok ||
		envelope.error ||
		!envelope.result ||
		!("data" in envelope.result)
	)
		throw new Error(
			`Daemon settings request failed: ${envelope.error?.message ?? response.status}. No offline write attempted.`,
		);
	return envelope.result.data;
}

async function openExisting(
	filename: string,
	readOnly = true,
): Promise<DatabaseSync> {
	await access(filename, constants.F_OK);
	return new DatabaseSync(filename, { readOnly });
}

function readOverrides(connection: DatabaseSync): Record<string, unknown> {
	const row = connection
		.prepare("SELECT settings_json FROM settings LIMIT 1")
		.get();
	if (row?.settings_json == null)
		throw new Error(
			"No v7 settings found. Start cross-seed once to initialize or migrate your configuration.",
		);
	const parsed: unknown = JSON.parse(String(row.settings_json));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error(
			"Stored settings must be a JSON object. Use config import with a valid settings export to replace them.",
		);
	return parsed as Record<string, unknown>;
}

export async function readSettings(
	filename: string,
	effective = false,
): Promise<Record<string, unknown>> {
	const live = await daemonRequest(filename, "settings.get");
	if (live !== undefined) {
		const config = requireObject(requireObject(live).config);
		return effective
			? config
			: stripDefaults(RUNTIME_CONFIG_SCHEMA.strict().parse(config));
	}
	const connection = await openExisting(filename);
	try {
		const overrides = readOverrides(connection);
		return effective
			? { ...getDefaultRuntimeConfig(), ...overrides }
			: overrides;
	} finally {
		connection.close();
	}
}

// This deliberately does not start the daemon, migrate the DB, connect clients,
// or validate filesystem availability: it must work when startup is broken.
export async function editSettings(
	filename: string,
	edit: (settings: Record<string, unknown>) => unknown,
	replace = false,
): Promise<void> {
	const connection = await openExisting(filename, false);
	try {
		connection.exec("BEGIN IMMEDIATE");
		try {
			const input = edit(replace ? {} : readOverrides(connection));
			const validated = RUNTIME_CONFIG_SCHEMA.strict().parse({
				...getDefaultRuntimeConfig(),
				...requireObject(input),
			});
			const json = JSON.stringify(stripDefaults(validated));
			// Never silently invent the v7 settings schema or import a config.js.
			const row = connection
				.prepare("SELECT rowid FROM settings LIMIT 1")
				.get();
			if (row)
				connection
					.prepare("UPDATE settings SET settings_json = ?")
					.run(json);
			else
				connection
					.prepare("INSERT INTO settings (settings_json) VALUES (?)")
					.run(json);
			connection.exec("COMMIT");
		} catch (error) {
			connection.exec("ROLLBACK");
			throw error;
		}
	} finally {
		connection.close();
	}
}

function requireObject(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Settings must be a JSON object.");
	return input as Record<string, unknown>;
}

function checkKey(key: string): void {
	if (!Object.hasOwn(RUNTIME_CONFIG_SCHEMA.shape, key))
		throw new Error(`Unknown setting: ${key}`);
}

export async function setSetting(
	filename: string,
	key: string,
	value: unknown,
): Promise<"daemon" | "offline"> {
	checkKey(key);
	if (key === "torznab")
		throw new Error(
			"Manage indexers in Settings → Trackers; changing legacy torznab does not update the indexer table. Use db backup to preserve indexers.",
		);
	RUNTIME_CONFIG_SCHEMA.shape[
		key as keyof typeof RUNTIME_CONFIG_SCHEMA.shape
	].parse(value);
	if (
		(await daemonRequest(filename, "settings.save", { [key]: value })) !==
		undefined
	)
		return "daemon";
	await editSettings(filename, (settings) => ({ ...settings, [key]: value }));
	return "offline";
}

export async function unsetSetting(
	filename: string,
	key: string,
): Promise<"daemon" | "offline"> {
	if (
		(await daemonRequest(filename, "settings.unset", { key })) !== undefined
	)
		return "daemon";
	await editSettings(filename, (settings) => {
		if (!Object.hasOwn(settings, key)) checkKey(key);
		delete settings[key];
		return settings;
	});
	return "offline";
}

export async function exportSettings(
	filename: string,
	destination: string,
): Promise<void> {
	const settings = await readSettings(filename);
	await writeFile(destination, JSON.stringify(settings, null, 2) + "\n", {
		flag: "wx",
		mode: 0o600,
	});
}

export async function importSettings(
	filename: string,
	source: string,
): Promise<"daemon" | "offline"> {
	const parsed: unknown = JSON.parse(await readFile(source, "utf8"));
	const settings = requireObject(parsed);
	if (Array.isArray(settings.torznab) && settings.torznab.length > 0)
		throw new Error(
			"Legacy torznab URLs cannot be imported as settings. Configure indexers in Settings → Trackers, then remove torznab from this JSON. Use db backup to preserve indexers.",
		);
	const validated = RUNTIME_CONFIG_SCHEMA.strict().parse({
		...getDefaultRuntimeConfig(),
		...settings,
	});
	if (
		(await daemonRequest(filename, "settings.replace", validated)) !==
		undefined
	)
		return "daemon";
	await editSettings(filename, () => parsed, true);
	return "offline";
}

export async function checkDatabase(filename: string): Promise<void> {
	const connection = await openExisting(filename);
	try {
		const rows = connection.prepare("PRAGMA quick_check").all();
		if (rows.length !== 1 || rows[0].quick_check !== "ok")
			throw new Error("SQLite integrity check failed.");
	} finally {
		connection.close();
	}
}

export async function backupDatabase(
	filename: string,
	destination: string,
): Promise<void> {
	if (resolve(filename) === resolve(destination))
		throw new Error(
			"Backup destination must differ from the live database.",
		);
	// Reserve the filename atomically and privately; never overwrite a backup.
	const reserved = await open(destination, "wx", 0o600);
	await reserved.close();
	try {
		const connection = await openExisting(filename);
		try {
			await backup(connection, destination);
		} finally {
			connection.close();
		}
		await checkDatabase(destination);
	} catch (error) {
		await unlink(destination).catch(() => undefined);
		throw error;
	}
}

function action(
	run: (...args: never[]) => Promise<void>,
): (...args: never[]) => Promise<void> {
	return async (...args) => {
		try {
			await run(...args);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(message);
			if (
				/malformed|not a database|integrity check failed/i.test(message)
			)
				console.error(recoveryAdvice);
			process.exitCode = 1;
		}
	};
}

function reportSave(mode: "daemon" | "offline"): void {
	console.error(
		mode === "daemon"
			? "Saved and applied by the running daemon. Listener settings (host, port, basePath) take effect on restart."
			: "Saved offline. Start cross-seed to apply.",
	);
}

export function registerConfigCommands(program: Command): void {
	const config = program
		.command("config")
		.description(
			"Inspect or repair stored v7 settings without starting the daemon. JSON output may contain secrets.",
		)
		.addHelpText(
			"after",
			"\nA running local daemon applies changes through its settings API. With the daemon stopped, edits use SQLite; start it afterward. Values use runtime JSON types (durations are milliseconds).\nExports contain settings only, not indexers/users/history; use db backup for a complete snapshot.",
		);
	config
		.command("show")
		.description("Print persisted overrides as JSON (including secrets)")
		.option("--effective", "Include defaults")
		.action(
			action(async (options: { effective?: boolean }) => {
				console.log(
					JSON.stringify(
						await readSettings(databasePath(), options.effective),
						null,
						2,
					),
				);
			}),
		);
	config
		.command("get <key>")
		.description("Print one effective setting as JSON")
		.action(
			action(async (key: string) => {
				checkKey(key);
				const settings = await readSettings(databasePath(), true);
				console.log(JSON.stringify(settings[key] ?? null));
			}),
		);
	config
		.command("set <key> <json>")
		.description("Set one setting to a JSON value")
		.action(
			action(async (key: string, json: string) => {
				const value: unknown = JSON.parse(json);
				const mode = await setSetting(databasePath(), key, value);
				reportSave(mode);
			}),
		);
	config
		.command("unset <key>")
		.description("Remove an override and restore its default")
		.action(
			action(async (key: string) => {
				const mode = await unsetSetting(databasePath(), key);
				reportSave(mode);
			}),
		);
	config
		.command("export <file>")
		.description(
			"Export settings, including secrets, to a new private JSON file",
		)
		.action(
			action(async (file: string) => {
				await exportSettings(databasePath(), file);
			}),
		);
	config
		.command("import <file>")
		.description(
			"Validate and replace settings from JSON. Does not replace indexers/users/history.",
		)
		.action(
			action(async (file: string) => {
				const mode = await importSettings(databasePath(), file);
				reportSave(mode);
			}),
		);
	const database = program
		.command("db")
		.description(
			"Database diagnostics and consistent backups; never starts or migrates the database",
		);
	database
		.command("check")
		.description("Run a read-only SQLite quick integrity check")
		.action(
			action(async () => {
				await checkDatabase(databasePath());
				console.log("SQLite quick_check: ok");
			}),
		);
	database
		.command("backup <file>")
		.description(
			"Create a new consistent full SQLite backup, including WAL data; contains secrets",
		)
		.action(
			action(async (file: string) => {
				await backupDatabase(databasePath(), file);
				console.log(`Backup verified: ${file}`);
			}),
		);
	database.addHelpText("after", `\nRecovery: ${recoveryAdvice}`);
}
