import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	// Create user table (singular naming)
	await knex.schema.createTable("user", (table) => {
		table.increments("id").primary();
		table.string("username").unique().notNullable();
		table.string("password").notNullable();
		table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
	});

	// Create session table (singular naming)
	await knex.schema.createTable("session", (table) => {
		table.string("id").primary();
		table.integer("user_id").notNullable().references("id").inTable("user");
		table.integer("expires_at").notNullable();
		table.integer("created_at").notNullable();
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.dropTable("session");
	await knex.schema.dropTable("user");
}

export default { name: "09-user-auth", up, down };
