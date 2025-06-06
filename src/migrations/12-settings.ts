import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("settings", (table) => {
		table.json("settings_json");
	});

	// Add performance indices for stats queries
	await knex.schema.alterTable("decision", (table) => {
		table.index("decision", "idx_decision_decision");
		table.index("last_seen", "idx_decision_last_seen");
		table.index(
			["decision", "last_seen"],
			"idx_decision_decision_last_seen",
		);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("decision", (table) => {
		table.dropIndex(
			["decision", "last_seen"],
			"idx_decision_decision_last_seen",
		);
		table.dropIndex("last_seen", "idx_decision_last_seen");
		table.dropIndex("decision", "idx_decision_decision");
	});

	await knex.schema.alterTable("settings", (table) => {
		table.dropColumn("settings_json");
	});
}

export default { name: "12-settings", up, down };
