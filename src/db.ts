// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Knex from "knex";
import { join } from "path";
import { appDir } from "./configuration.js";
import { migrations } from "./migrations/migrations.js";
import BetterSqlite3Client from "knex/lib/dialects/better-sqlite3/index.js";
import { DatabaseSync } from "node:sqlite";

export class NodeSqliteClient extends BetterSqlite3Client {
	_driver() {
		return DatabaseSync;
	}

	// Get a raw connection from the database, returning a promise with the connection object.
	async acquireRawConnection() {
		// @ts-expect-error these exist on the parent class
		const connection = new this.driver(this.connectionSettings.filename);
		connection.exec("pragma journal_mode = WAL;");
		return connection;
	}

	// Used to explicitly close a connection, called internally by the pool when
	// a connection times out or the pool is shutdown.
	async destroyRawConnection(connection) {
		return connection.close();
	}

	// Runs the query on the specified connection, providing the bindings and any
	// other necessary prep work.
	async _query(connection, obj) {
		if (!obj.sql) throw new Error("The query is empty");

		if (!connection) {
			throw new Error("No connection provided");
		}

		const statement = connection.prepare(obj.sql);
		// @ts-expect-error _formatBindings exists on the parent class
		const bindings = this._formatBindings(obj.bindings);

		// hack - if we use an INSERT…RETURNING statement it won't work
		if (obj.sql.toLowerCase().startsWith("select")) {
			obj.response = await statement.all(...bindings);
			return obj;
		}

		const response = await statement.run(...bindings);
		obj.response = response;
		obj.context = {
			lastID: response.lastInsertRowid,
			changes: response.changes,
		};

		return obj;
	}
}
//@ts-expect-error set the driver name
NodeSqliteClient.prototype.driverName = "node:sqlite";

const filename = join(appDir(), "cross-seed.db");

export const db = Knex.knex({
	// @ts-expect-error types don't allow customizable client but it works
	client: NodeSqliteClient,
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});

export const memDB = Knex.knex({
	// @ts-expect-error types don't allow customizable client but it works
	client: NodeSqliteClient,
	connection: ":memory:",
	useNullAsDefault: true,
});
await memDB.schema.createTable("torrent", (table) => {
	table.string("info_hash").primary();
	table.string("name");
	table.string("title");
	table.json("files");
	table.integer("length");
	table.string("save_path");
	table.string("category");
	table.json("tags");
	table.json("trackers");
});
await memDB.schema.createTable("data", (table) => {
	table.string("path").primary();
	table.string("title");
});
await memDB.schema.createTable("ensemble", (table) => {
	table.string("path").primary();
	table.string("info_hash").unique();
	table.string("ensemble");
	table.string("element");
});
