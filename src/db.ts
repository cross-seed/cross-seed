import { knex } from "knex";
import { join } from "path";
import { appDir } from "./configuration.js";
import { migrations } from "./migrations/migrations.js";
import Sqlite from "better-sqlite3";

const filename = join(appDir(), "cross-seed.db");
const rawSqliteHandle = new Sqlite(filename);
rawSqliteHandle.pragma("journal_mode = WAL");
rawSqliteHandle.close();

export const db = knex({
	client: "better-sqlite3",
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});
