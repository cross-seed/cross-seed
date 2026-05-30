import knex from "knex";

export async function up(knex: knex.Knex): Promise<void> {
	await knex.transaction(async (trx) => {
		const inactiveIds = await trx("indexer")
			.whereRaw("active = 0")
			.select("id");

		if (inactiveIds.length) {
			const ids = inactiveIds.map((row) => row.id);
			await trx("timestamp").whereIn("indexer_id", ids).del();
			await trx("rss").whereIn("indexer_id", ids).del();
			await trx("indexer").whereIn("id", ids).del();
		}

		await trx.raw("UPDATE indexer SET active = NULL");
	});
}

export async function down(): Promise<void> {}

export default { name: "16-prune-inactive-indexers", up, down };
