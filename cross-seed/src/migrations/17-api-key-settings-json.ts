import Knex from "knex";

type SettingsRow = {
	id: number;
	apikey: string | null;
	settings_json: string | null;
};

async function up(knex: Knex.Knex): Promise<void> {
	const rows = await knex<SettingsRow>("settings").select(
		"id",
		"apikey",
		"settings_json",
	);

	for (const row of rows) {
		if (!row.apikey) continue;

		const settings =
			row.settings_json == null
				? {}
				: (JSON.parse(row.settings_json) as Record<string, unknown>);
		if (typeof settings.apiKey === "string" && settings.apiKey.length > 0) {
			continue;
		}

		await knex("settings")
			.where({ id: row.id })
			.update({
				settings_json: JSON.stringify({
					...settings,
					apiKey: row.apikey,
				}),
			});
	}
}

async function down(): Promise<void> {}

export default { name: "17-api-key-settings-json", up, down };
