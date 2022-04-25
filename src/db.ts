import Knex from "knex";
import { join } from "path";
import { appDir } from "./configuration.js";
import { migrations } from "./migrations/migrations.js";

export const db = Knex.knex({
	client: "better-sqlite3",
	connection: { filename: join(appDir(), "cross-seed.db") },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});
