import { join } from "path";
import stripAnsi from "strip-ansi";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { parseClientEntry } from "./clients/TorrentClient.js";
import { appDir, createAppDirHierarchy } from "./configuration.js";
import { LOGS_FOLDER } from "./constants.js";

export enum Label {
	QBITTORRENT = "qbittorrent",
	RTORRENT = "rtorrent",
	TRANSMISSION = "transmission",
	DELUGE = "deluge",
	DECIDE = "decide",
	PREFILTER = "prefilter",
	CONFIG = "config",
	TORZNAB = "torznab",
	SERVER = "server",
	SCHEDULER = "scheduler",
	SEARCH = "search",
	RSS = "rss",
	ANNOUNCE = "announce",
	WEBHOOK = "webhook",
	INJECT = "inject",
	PERF = "perf",
	CLEANUP = "cleanup",
	ARRS = "arrs",
	RADARR = "radarr",
	SONARR = "sonarr",
	AUTH = "auth",
	INDEX = "index",
}

export let logger: winston.Logger;

const REDACTED_MSG = "[REDACTED]";
const ERROR_PREFIX_REGEX = /^\s*error:\s*/i;
const SUB_SECOND_TS_REGEX = /\.\d{3,}$/;

function redactUrlPassword(message: string, urlStr: string) {
	let url: URL;
	try {
		url = new URL(urlStr);
		if (url.password) {
			const urlDecodedPassword = decodeURIComponent(url.password);
			const urlEncodedPassword = encodeURIComponent(url.password);
			message = message.split(url.password).join(REDACTED_MSG);
			message = message.split(urlDecodedPassword).join(REDACTED_MSG);
			message = message.split(urlEncodedPassword).join(REDACTED_MSG);
		}
	} catch (e) {
		// do nothing
	}
	return message;
}

function redactMessage(
	message: string | unknown,
	options: Record<string, unknown>,
) {
	if (typeof message !== "string") {
		return message;
	}
	let ret = message;

	ret = ret.replace(/key=[a-zA-Z0-9]+/g, `key=${REDACTED_MSG}`);
	ret = ret.replace(/pass=[a-zA-Z0-9]+/g, `pass=${REDACTED_MSG}`);
	ret = ret.replace(
		/(?:(?:auto|download)[./]\d+[./])([a-zA-Z0-9]+)/g,
		(match, key) => match.replace(key, REDACTED_MSG),
	);
	ret = ret.replace(
		/(?:\d+[./](?:auto|download)[./])([a-zA-Z0-9]+)/g,
		(match, key) => match.replace(key, REDACTED_MSG),
	);
	ret = ret.replace(/apiKey: '.+'/g, `apiKey: ${REDACTED_MSG}`);

	ret = ret.replace(
		/\/notification\/crossSeed\/[a-zA-Z-0-9_-]+/g,
		`/notification/crossSeed/${REDACTED_MSG}`,
	);
	for (const [key, value] of Object.entries(options)) {
		if (key.endsWith("Url") && typeof value === "string") {
			ret = redactUrlPassword(ret, value);
		}
		if (key === "torrentClients" && Array.isArray(value)) {
			for (const clientEntry of value) {
				ret = redactUrlPassword(
					ret,
					parseClientEntry(clientEntry)!.url,
				);
			}
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

const logOnceCache: Set<string> = new Set();

export function logOnce(cacheKey: string, cb: () => void, ttl?: number) {
	if (!logOnceCache.has(cacheKey)) {
		logOnceCache.add(cacheKey);
		cb();

		if (ttl) {
			setTimeout(() => {
				logOnceCache.delete(cacheKey);
			}, ttl).unref();
		}
	}
}

export function initializeLogger(options: Record<string, unknown>): void {
	createAppDirHierarchy();
	logger = winston.createLogger({
		level: "info",
		format: winston.format.combine(
			winston.format.timestamp({
				format: "YYYY-MM-DD HH:mm:ss.SSS",
			}),
			winston.format.errors({ stack: true }),
			winston.format.splat(),
			winston.format.printf(
				({ level, message, label, timestamp, stack, cause }) => {
					const msg = !stack
						? `${message}${cause ? `\n${cause}` : ""}`
						: `${stack}${cause ? `\n${cause}` : ""}`.replace(
								ERROR_PREFIX_REGEX,
								"",
							);
					return `${timestamp} ${level}: ${
						label ? `[${label}] ` : ""
					}${stripAnsiChars(redactMessage(msg, options))}`;
				},
			),
		),
		transports: [
			new DailyRotateFile({
				filename: "error.%DATE%.log",
				createSymlink: true,
				symlinkName: "error.current.log",
				dirname: join(appDir(), LOGS_FOLDER),
				maxFiles: "14d",
				level: "error",
			}),
			new DailyRotateFile({
				filename: "info.%DATE%.log",
				createSymlink: true,
				symlinkName: "info.current.log",
				dirname: join(appDir(), LOGS_FOLDER),
				maxFiles: "14d",
			}),
			new DailyRotateFile({
				filename: "verbose.%DATE%.log",
				createSymlink: true,
				symlinkName: "verbose.current.log",
				dirname: join(appDir(), LOGS_FOLDER),
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
						({
							level,
							message,
							label,
							timestamp,
							stack,
							cause,
						}) => {
							timestamp = timestamp.replace(
								SUB_SECOND_TS_REGEX,
								"",
							);
							const msg = !stack
								? `${message}${cause ? `\n${cause}` : ""}`
								: `${stack}${cause ? `\n${cause}` : ""}`.replace(
										ERROR_PREFIX_REGEX,
										"",
									);
							return `${timestamp} ${level}: ${
								label ? `[${label}] ` : ""
							}${redactMessage(msg, options)}`;
						},
					),
				),
			}),
		],
	});
}
