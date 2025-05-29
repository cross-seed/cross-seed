import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	const oldSettings = await knex("settings").select("apikey").first();
	await knex.schema.alterTable("settings", (table) => {
		table.dropColumn("apikey");
		table.json("settings_json");
	});
	if (oldSettings) {
		await knex("settings").update({
			settings_json: JSON.stringify({ apiKey: oldSettings.apikey }),
		});
	}
}

async function down(knex: Knex.Knex): Promise<void> {
	const oldSettings = await knex("settings").select("settings_json").first();
	await knex.schema.alterTable("settings", (table) => {
		table.dropColumn("settings_json");
		table.string("apikey");
	});
	if (oldSettings) {
		await knex("settings").update({
			// @ts-expect-error obviously the types won't match
			apikey: JSON.parse(oldSettings.settings_json).apiKey,
		});
	}
}

export default { name: "13-settings", up, down };
