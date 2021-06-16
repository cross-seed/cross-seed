import { createLogger, format, transports } from "winston";
import { getRuntimeConfig } from "./runtimeConfig";

export const logger = createLogger({
	level: "info",
	format: format.combine(
		format.timestamp({
			format: "YYYY-MM-DD HH:mm:ss",
		}),
		format.errors({ stack: true }),
		format.splat(),
		format.json()
	),
	transports: [
		new transports.File({
			filename: "error.log",
			level: "error",
		}),
		new transports.File({
			filename: "info.log",
		}),
		new transports.File({ filename: "verbose.log", level: "silly" }),
		new transports.Console({
			level: getRuntimeConfig().verbose ? "silly" : "info",
			format: format.combine(format.colorize(), format.simple()),
		}),
	],
});
