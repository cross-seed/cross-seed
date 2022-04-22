import { migrations } from "./migrations/migrations.js";

export default {
	client: "better-sqlite3",
	connection: { filename: "./test.db" },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
};
