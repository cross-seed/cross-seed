import initialSchema from "./00-initialSchema.js";

export const migrations = {
	getMigrations: () => Promise.resolve([initialSchema]),
	getMigrationName: (migration) => migration.name,
	getMigration: (migration) => migration,
};
