import Knex from "knex";

async function up(knex: Knex.Knex): Promise<void> {
	await knex.schema.table("searchee", (table) => {
		table.string("source").index();
		table.string("info_hash").index();
		table.string("path").index();
		table.string("client_host").index();
		table.string("title");
		table.string("raw_name");
		table.json("files");
		table.integer("length");
		table.string("save_path");
		table.string("category");
		table.json("tags");
		table.json("trackers");
		table.integer("updated_at");
	});

	await knex("searchee").update({
		title: knex.ref("name"),
		raw_name: knex.ref("name"),
	});
}

async function down(knex: Knex.Knex): Promise<void> {
	await knex.schema.table("searchee", (table) => {
		table.dropIndex(["source"]);
		table.dropIndex(["info_hash"]);
		table.dropIndex(["path"]);
		table.dropIndex(["client_host"]);
		table.dropColumn("source");
		table.dropColumn("info_hash");
		table.dropColumn("path");
		table.dropColumn("client_host");
		table.dropColumn("title");
		table.dropColumn("raw_name");
		table.dropColumn("files");
		table.dropColumn("length");
		table.dropColumn("save_path");
		table.dropColumn("category");
		table.dropColumn("tags");
		table.dropColumn("trackers");
		table.dropColumn("updated_at");
	});
}

export default { name: "17-searchee-metadata", up, down };
