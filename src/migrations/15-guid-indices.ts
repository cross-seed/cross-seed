import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	// Add performance indices for guidInfoHashMap queries
	await knex.schema.alterTable("decision", (table) => {
		// Index for the main guidInfoHashMap query: SELECT guid, info_hash FROM decision WHERE info_hash IS NOT NULL
		table.index(["info_hash", "guid"], "idx_decision_info_hash_guid");

		// Index for direct GUID lookups in guidLookup function
		table.index("guid", "idx_decision_guid");
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.alterTable("decision", (table) => {
		table.dropIndex("guid", "idx_decision_guid");
		table.dropIndex(["info_hash", "guid"], "idx_decision_info_hash_guid");
	});
}

export default { name: "15-guid-indices", up, down };
