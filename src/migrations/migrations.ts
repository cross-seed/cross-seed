import initialSchema from "./00-initialSchema.js";
import jobs from "./01-jobs.js";
import timestamps from "./02-timestamps.js";
import rateLimits from "./03-rateLimits.js";
import auth from "./04-auth.js";
import caps from "./05-caps.js";
import uniqueDecisions from "./06-uniqueDecisions.js";
import limits from "./07-limits.js";
import rss from "./08-rss.js";
import clientAndDataSearchees from "./09-clientAndDataSearchees.js";

export const migrations = {
	getMigrations: () =>
		Promise.resolve([
			initialSchema,
			jobs,
			timestamps,
			rateLimits,
			auth,
			caps,
			uniqueDecisions,
			limits,
			rss,
			clientAndDataSearchees,
		]),
	getMigrationName: (migration) => migration.name,
	getMigration: (migration) => migration,
};
