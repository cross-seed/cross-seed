import type { Knex } from "knex";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

export interface SettingsTransaction {
	read(): Promise<string | null | undefined>;
	write(json: string): Promise<void>;
}

export interface SettingsPersistence {
	read(): Promise<string | null | undefined>;
	transaction<T>(
		action: (transaction: SettingsTransaction) => Promise<T>,
	): Promise<T>;
}

/** Uses an already initialized daemon DB; imports neither startup nor global DB. */
export function createKnexSettingsPersistence(
	database: Knex,
): SettingsPersistence {
	async function read(connection: Knex) {
		const row = await connection<{ settings_json: string | null }>(
			"settings",
		)
			.select("settings_json")
			.first();
		return row?.settings_json;
	}
	return {
		read: () => read(database),
		transaction: (action) =>
			database.transaction(async (trx) =>
				action({
					read: () => read(trx),
					async write(json) {
						const row = await trx("settings").first();
						if (row)
							await trx("settings").update({
								settings_json: json,
							});
						else
							await trx("settings").insert({
								apikey: null,
								settings_json: json,
							});
					},
				}),
			),
	};
}

/** Opens only an existing file. Does not migrate, initialize, or repair SQLite. */
export function createSqliteSettingsPersistence(
	filename: string,
): SettingsPersistence {
	async function openExisting(readOnly: boolean) {
		await access(filename, constants.F_OK);
		return new DatabaseSync(filename, { readOnly });
	}
	function read(connection: DatabaseSync): string | null | undefined {
		const row = connection
			.prepare("SELECT settings_json FROM settings LIMIT 1")
			.get();
		const value = row?.settings_json;
		return value == null ? value : String(value);
	}
	return {
		async read() {
			const connection = await openExisting(true);
			try {
				return read(connection);
			} finally {
				connection.close();
			}
		},
		async transaction(action) {
			const connection = await openExisting(false);
			try {
				connection.exec("BEGIN IMMEDIATE");
				try {
					const result = await action({
						read: () => Promise.resolve(read(connection)),
						write(json) {
							const row = connection
								.prepare("SELECT rowid FROM settings LIMIT 1")
								.get();
							if (row)
								connection
									.prepare(
										"UPDATE settings SET settings_json = ?",
									)
									.run(json);
							else
								connection
									.prepare(
										"INSERT INTO settings (apikey, settings_json) VALUES (NULL, ?)",
									)
									.run(json);
							return Promise.resolve();
						},
					});
					connection.exec("COMMIT");
					return result;
				} catch (error) {
					connection.exec("ROLLBACK");
					throw error;
				}
			} finally {
				connection.close();
			}
		},
	};
}
