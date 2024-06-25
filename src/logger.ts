import { join } from "path";
import stripAnsi from "strip-ansi";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { appDir, createAppDir } from "./configuration.js";
import { getRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";

export enum Label {
	QBITTORRENT = "qbittorrent",
	RTORRENT = "rtorrent",
	TRANSMISSION = "transmission",
	DELUGE = "deluge",
	DECIDE = "decide",
	PREFILTER = "prefilter",
	CONFIGDUMP = "configdump",
	TORZNAB = "torznab",
	SERVER = "server",
	STARTUP = "startup",
	SCHEDULER = "scheduler",
	SEARCH = "search",
	RSS = "rss",
	ANNOUNCE = "announce",
	WEBHOOK = "webhook",
	PERF = "perf",
	ARRS = "arrs",
	RADARR = "radarr",
	SONARR = "sonarr",
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

function redactMessage(message: string | unknown, options?: RuntimeConfig) {
	if (typeof message !== "string") {
		return message;
	}
	const runtimeConfig = options ?? getRuntimeConfig();
	let ret = message;

	ret = ret.replace(/key=[a-zA-Z0-9]+/g, `key=${redactionMsg}`);
	ret = ret.replace(/pass=[a-zA-Z0-9]+/g, `pass=${redactionMsg}`);
	ret = ret.replace(/(?:auto\.\d+\.)([a-zA-Z0-9]+)/g, (match, key) =>
		match.replace(key, redactionMsg),
	);
	ret = ret.replace(/apiKey: '.+'/g, `apiKey: ${redactionMsg}`);

	ret = ret.replace(
		/\/notification\/crossSeed\/[a-zA-Z-0-9_-]+/g,
		`/notification/crossSeed/${redactionMsg}`,
	);
	for (const [key, urlStr] of Object.entries(runtimeConfig)) {
		if (key.endsWith("Url") && urlStr) {
			ret = redactUrlPassword(ret, urlStr);
		}
	}
	return ret;
}

function stripAnsiChars(message: string | unknown) {
	if (typeof message !== "string") {
		return message;
	}
	return stripAnsi(message);
}

const logOnceCache: string[] = [];
export function logOnce(cacheKey: string, cb: () => void) {
	if (!logOnceCache.includes(cacheKey)) {
		logOnceCache.push(cacheKey);
		cb();
	}
}

export function initializeLogger(options: RuntimeConfig): void {
	createAppDir();
	logger = winston.createLogger({
		level: "info",
		format: winston.format.combine(
			winston.format.timestamp({
				format: "YYYY-MM-DD HH:mm:ss",
			}),
			winston.format.errors({ stack: true }),
			winston.format.splat(),
			winston.format.printf(
				({ level, message, label, timestamp, stack }) => {
					return `${timestamp} ${level}: ${
						label ? `[${label}] ` : ""
					}${stripAnsiChars(redactMessage(stack ? stack : message, options))}`;
				},
			),
		),
		transports: [
			new DailyRotateFile({
				filename: "error.%DATE%.log",
				createSymlink: true,
				symlinkName: "error.current.log",
				dirname: join(appDir(), "logs"),
				maxFiles: "14d",
				level: "error",
			}),
			new DailyRotateFile({
				filename: "info.%DATE%.log",
				createSymlink: true,
				symlinkName: "info.current.log",
				dirname: join(appDir(), "logs"),
				maxFiles: "14d",
			}),
			new DailyRotateFile({
				filename: "verbose.%DATE%.log",
				createSymlink: true,
				symlinkName: "verbose.current.log",
				dirname: join(appDir(), "logs"),
				maxFiles: "14d",
				level: "silly",
			}),
			new winston.transports.Console({
				level: options.verbose ? "silly" : "info",
				format: winston.format.combine(
					winston.format.errors({ stack: true }),
					winston.format.splat(),
					winston.format.colorize(),
					winston.format.printf(
						({ level, message, label, timestamp, stack }) => {
							return `${timestamp} ${level}: ${
								label ? `[${label}] ` : ""
							}${redactMessage(
								stack ? stack : message,
								options,
							)}`;
						},
					),
				),
			}),
		],
	});
}
