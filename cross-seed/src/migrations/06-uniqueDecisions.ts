import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	// Remove null info_hash as we may run out of memory if too many entries
	await knex("decision").whereNull("info_hash").del();

	// Remove duplicate decisions preserving the most recent one
	await knex.raw(`
        DELETE FROM decision
        WHERE id NOT IN (
            SELECT id
            FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY searchee_id, guid ORDER BY last_seen DESC) AS row_num
                FROM decision
            ) AS subquery
            WHERE row_num = 1
        )
    `);

	// Add unique constraint to prevent duplicates and add fuzzy_size_factor
	await knex.schema.alterTable("decision", (table) => {
		table.float("fuzzy_size_factor").defaultTo(0.02);
		table.unique(["searchee_id", "guid"]);
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	return knex.schema.alterTable("decision", (table) => {
		table.dropColumn("fuzzy_size_factor");
		table.dropUnique(["searchee_id", "guid"]);
	});
}

export default { name: "06-uniqueDecisions", up, down };
