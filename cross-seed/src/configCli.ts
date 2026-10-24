import { Command } from "commander";
import { constants } from "node:fs";
import { access, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { appDir } from "./configuration.js";
import { createCli } from "trpc-cli";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "./trpc/routers/index.js";
import type { RuntimeConfigOverrides } from "@cross-seed/shared/configSchema";
import type { DaemonDescriptor } from "./configDaemonDiscovery.js";
import {
	createSettingsService,
	type SettingsService,
} from "./settingsService.js";
import { createSqliteSettingsPersistence } from "./settingsPersistence.js";
import { settingsApiRouter } from "./settingsApi.js";

const recoveryAdvice =
	"Stop cross-seed and preserve cross-seed.db and any -wal/-shm files together before recovery. " +
	"Restore a known-good full database backup with the daemon stopped. Do not delete the database: it contains settings, indexers, users, and search history. " +
	"A settings JSON export is not a full database backup. No automatic repair has been attempted.";

export function databasePath(): string {
	return join(appDir(), "cross-seed.db");
}

// Only absence or a dead owner selects offline recovery. Once selected, a
// daemon transport/authentication/validation failure never falls back to SQLite.
async function discoverDaemon(
	filename: string,
): Promise<DaemonDescriptor | undefined> {
	let raw: string;
	try {
		raw = await readFile(join(dirname(filename), "daemon.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return undefined;
		throw error;
	}
	const descriptor = JSON.parse(raw) as DaemonDescriptor;
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
	return descriptor;
}

function remoteSettings(descriptor: DaemonDescriptor): SettingsService {
	const client = createTRPCClient<AppRouter>({
		links: [
			httpLink({
				url: descriptor.url!,
				headers: { authorization: `Bearer ${descriptor.token}` },
				fetch: (url, options) =>
					fetch(url, {
						...options,
						redirect: "error",
						signal: AbortSignal.timeout(10000),
					}),
			}),
		],
	});
	return {
		read: (effective = false) => client.config.show.query({ effective }),
		async patch(changes) {
			await client.config.set.mutate(changes as RuntimeConfigOverrides);
		},
		async unset(key) {
			await client.config.unset.mutate({ key });
		},
		async replace(settings) {
			await client.config.replace.mutate(
				settings as RuntimeConfigOverrides,
			);
		},
	};
}

const offlineServices = new Map<string, SettingsService>();
async function settingsTarget(
	filename: string,
): Promise<{ service: SettingsService; mode: "daemon" | "offline" }> {
	const daemon = await discoverDaemon(filename);
	if (daemon) return { service: remoteSettings(daemon), mode: "daemon" };
	const key = resolve(filename);
	let service = offlineServices.get(key);
	if (!service) {
		service = createSettingsService(createSqliteSettingsPersistence(key));
		offlineServices.set(key, service);
	}
	return { service, mode: "offline" };
}

export async function readSettings(
	filename: string,
	effective = false,
): Promise<Record<string, unknown>> {
	return (await settingsTarget(filename)).service.read(effective);
}
export async function setSetting(
	filename: string,
	key: string,
	value: unknown,
): Promise<"daemon" | "offline"> {
	const { service, mode } = await settingsTarget(filename);
	await service.patch({ [key]: value });
	return mode;
}
export async function unsetSetting(
	filename: string,
	key: string,
): Promise<"daemon" | "offline"> {
	const { service, mode } = await settingsTarget(filename);
	await service.unset(key);
	return mode;
}
export async function exportSettings(
	filename: string,
	destination: string,
): Promise<void> {
	await writeFile(
		destination,
		JSON.stringify(await readSettings(filename), null, 2) + "\n",
		{ flag: "wx", mode: 0o600 },
	);
}
export async function importSettings(
	filename: string,
	source: string,
): Promise<"daemon" | "offline"> {
	const input: unknown = JSON.parse(await readFile(source, "utf8"));
	const { service, mode } = await settingsTarget(filename);
	await service.replace(input);
	return mode;
}

async function openExisting(
	filename: string,
	readOnly = true,
): Promise<DatabaseSync> {
	await access(filename, constants.F_OK);
	return new DatabaseSync(filename, { readOnly });
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

export function reportConfigError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	if (/malformed|not a database|integrity check failed/i.test(message))
		console.error(recoveryAdvice);
	process.exitCode = 1;
}

function action(
	run: (...args: never[]) => Promise<void>,
): (...args: never[]) => Promise<void> {
	return async (...args) => {
		try {
			await run(...args);
		} catch (error) {
			reportConfigError(error);
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

/** Generated commands are adapters over the same router used by the daemon. */
export function createConfigCommand(
	filename = databasePath(),
	argv?: string[],
): Command {
	const read = async (effective?: boolean) =>
		(await settingsTarget(filename)).service.read(effective);
	const mutate = async (
		operation: (service: SettingsService) => Promise<void>,
	) => {
		const { service, mode } = await settingsTarget(filename);
		await operation(service);
		reportSave(mode);
	};
	const settingsService: SettingsService = {
		read,
		patch: (changes) => mutate((service) => service.patch(changes)),
		unset: (key) => mutate((service) => service.unset(key)),
		replace: (settings) => mutate((service) => service.replace(settings)),
	};
	const command = createCli({
		router: settingsApiRouter,
		name: "config",
		jsonInput: "auto",
		description:
			"Inspect and edit v7 settings through the daemon or offline recovery. Output may contain secrets.",
		context: { settingsService },
	}).buildProgram({
		argv,
		prompts: false,
		logger: {
			info: (value) => console.log(JSON.stringify(value, null, 2)),
			error: (error) => console.error(error),
		},
	}) as Command;
	// Commander's help is presentation text, while procedure results are JSON.
	const configureHelp = (cmd: Command) => {
		cmd.configureOutput({
			writeOut: (text) => {
				process.stdout.write(text);
			},
			writeErr: (text) => {
				process.stderr.write(text);
			},
		});
		for (const child of cmd.commands) configureHelp(child);
	};
	configureHelp(command);
	return command;
}

export function registerConfigCommands(program: Command): void {
	const config = createConfigCommand();
	program.addCommand(config);
	config.addHelpText(
		"after",
		"\nA running local daemon applies changes through its settings API. Offline edits use the same validation and change settings only. Durations use milliseconds unless stated otherwise. Listener changes require restart.\nExports contain settings only, not indexers/users/history; use db backup for a complete snapshot.",
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
