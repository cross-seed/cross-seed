import { join } from "path";
import winston from "winston";
import { appDir, createAppDir } from "./configuration.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

export enum Label {
	QBITTORRENT = "qbittorrent",
	RTORRENT = "rtorrent",
	DECIDE = "decide",
	PREFILTER = "prefilter",
	CONFIGDUMP = "configdump",
	JACKETT = "jackett",
	SERVER = "server",
	STARTUP = "startup",
}

export let logger: winston.Logger;

const redactionMsg = "[REDACTED]";

function redactUrlPassword(message, urlStr) {
	let url;
	try {
		url = new URL(urlStr);
		if (url.password) {
			const urlDecodedPassword = decodeURIComponent(url.password);
			const urlEncodedPassword = encodeURIComponent(url.password);
			message = message.split(url.password).join(redactionMsg);
			message = message.split(urlDecodedPassword).join(redactionMsg);
			message = message.split(urlEncodedPassword).join(redactionMsg);
		}
	} catch (e) {
		// do nothing
	}
	return message;
}

function redactMessage(message) {
	const runtimeConfig = getRuntimeConfig();

	message = message.split(runtimeConfig.jackettApiKey).join(redactionMsg);

	for (const [key, urlStr] of Object.entries(runtimeConfig)) {
		if (key.endsWith("Url") && urlStr) {
			message = redactUrlPassword(message, urlStr);
		}
	}

	return message;
}

export function initializeLogger(): void {
	createAppDir();
	logger = winston.createLogger({
		level: "info",
		format: winston.format.combine(
			winston.format.timestamp({
				format: "YYYY-MM-DD HH:mm:ss",
			}),
			winston.format.errors({ stack: true }),
			winston.format.splat(),
			winston.format.colorize(),
			winston.format.printf(({ level, message, label, timestamp }) => {
				return `${timestamp} ${level}: ${
					label ? `[${label}] ` : ""
				}${redactMessage(message)}`;
			})
		),
		transports: [
			new winston.transports.File({
				filename: join(appDir(), "logs", "error.log"),
				level: "error",
			}),
			new winston.transports.File({
				filename: join(appDir(), "logs", "info.log"),
			}),
			new winston.transports.File({
				filename: join(appDir(), "logs", "verbose.log"),
				level: "silly",
			}),
			new winston.transports.Console({
				level: getRuntimeConfig().verbose ? "silly" : "info",
				format: winston.format.combine(
					winston.format.errors({ stack: true }),
					winston.format.splat(),
					winston.format.colorize(),
					winston.format.printf(({ level, message, label }) => {
						return `${level}: ${
							label ? `[${label}] ` : ""
						}${redactMessage(message)}`;
					})
				),
			}),
		],
	});
}
