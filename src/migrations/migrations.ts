import initialSchema from "./00-initialSchema.js";
import jobs from "./01-jobs.js";

// The first step of any migration should be to back up the database.

export const migrations = {
	getMigrations: () => Promise.resolve([initialSchema, jobs]),
	getMigrationName: (migration) => migration.name,
	getMigration: (migration) => migration,
};
