import { join } from "path";
import { createLogger, format, Logger, transports } from "winston";
import { appDir, createAppDir } from "./configuration";
import { getRuntimeConfig } from "./runtimeConfig";

export enum Label {
	QBITTORRENT = "qbittorrent",
	RTORRENT = "rtorrent",
	DECIDE = "decide",
	PREFILTER = "prefilter",
	CONFIGDUMP = "configdump",
	JACKETT = "jackett",
	SERVER = "server",
}

export let logger: Logger;

export function initializeLogger(): void {
	createAppDir();
	logger = createLogger({
		level: "info",
		format: format.combine(
			format.timestamp({
				format: "YYYY-MM-DD HH:mm:ss",
			}),
			format.errors({ stack: true }),
			format.splat(),
			format.colorize(),
			format.printf(({ level, message, label, timestamp }) => {
				return `${timestamp} ${level}: ${
					label ? `[${label}] ` : ""
				}${message}`;
			})
		),
		transports: [
			new transports.File({
				filename: join(appDir(), "logs", "error.log"),
				level: "error",
			}),
			new transports.File({
				filename: join(appDir(), "logs", "info.log"),
			}),
			new transports.File({
				filename: join(appDir(), "logs", "verbose.log"),
				level: "silly",
			}),
			new transports.Console({
				level: getRuntimeConfig().verbose ? "silly" : "info",
				format: format.combine(
					format.errors({ stack: true }),
					format.splat(),
					format.colorize(),
					format.printf(({ level, message, label }) => {
						return `${level}: ${
							label ? `[${label}] ` : ""
						}${message}`;
					})
				),
			}),
		],
	});
}
