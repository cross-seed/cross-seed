import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import { authedProcedure, router } from "../index.js";
import { Label, logger, streamTransport } from "../../logger.js";
import type { LogStreamEvent } from "../../transports/StreamTransport.js";

export interface LogEntry {
	timestamp: string;
	level: string;
	label: string;
	message: string;
}

function shouldIncludeLevel(logLevel: string, filterLevel: string): boolean {
	const levels = ["error", "warn", "info", "verbose", "debug"];
	const logIndex = levels.indexOf(logLevel);
	const filterIndex = levels.indexOf(filterLevel);
	return logIndex <= filterIndex;
}

export const logsRouter = router({
	getVerbose: authedProcedure.query(async () => {
		try {
			// Get the logs directory from the current working directory
			const logPath = join(process.cwd(), "logs/verbose.current.log");
			const logData = await fs.readFile(logPath, "utf-8");
			return logData;
		} catch (error) {
			logger.error({
				label: Label.SERVER,
				message: `Failed to read verbose logs: ${error.message}`,
			});
			throw new Error(`Failed to read verbose logs: ${error.message}`);
		}
	}),

	getRecentLogs: authedProcedure
		.input(
			z.object({
				level: z
					.enum(["error", "warn", "info", "verbose", "debug"])
					.default("info"),
				limit: z.number().min(1).max(1000).default(100),
			}),
		)
		.query(async ({ input }) => {
			try {
				// Map level to appropriate log file
				const logFileMap = {
					error: "error.current.log",
					warn: "warn.current.log",
					info: "info.current.log",
					verbose: "verbose.current.log",
					debug: "debug.current.log",
				};

				const logFileName = logFileMap[input.level];
				const logPath = join(process.cwd(), "logs", logFileName);

				// Check if the file exists
				try {
					await fs.access(logPath);
				} catch (e) {
					logger.warn({
						label: Label.SERVER,
						message: `Log file not found: ${logPath}`,
					});
					return [];
				}

				// Read the file
				const logData = await fs.readFile(logPath, "utf-8");

				// Parse the log file (assumes each line is a valid JSON object)
				const logEntries: LogEntry[] = [];
				const lines = logData.split("\n").filter(Boolean);

				// Process the most recent lines up to the limit
				const startIndex = Math.max(0, lines.length - input.limit);
				for (let i = startIndex; i < lines.length; i++) {
					try {
						const entry = JSON.parse(lines[i]);
						logEntries.push({
							timestamp:
								entry.timestamp || new Date().toISOString(),
							level: entry.level || input.level,
							label: entry.label || "UNKNOWN",
							message: entry.message || lines[i],
						});
					} catch (e) {
						// Skip malformed log entries
						logger.debug({
							label: Label.SERVER,
							message: `Failed to parse log entry: ${lines[i]}`,
						});
					}
				}

				// Return the entries in reverse order (newest first)
				return logEntries.reverse();
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: `Failed to read logs: ${error.message}`,
				});
				throw new Error(`Failed to read logs: ${error.message}`);
			}
		}),

	subscribe: authedProcedure
		.input(
			z.object({
				level: z
					.enum(["error", "warn", "info", "verbose", "debug"])
					.default("info"),
			}),
		)
		.subscription(async function* ({ input }) {
			const logQueue: LogStreamEvent[] = [];
			let resolve: (() => void) | null = null;

			const unsubscribe = streamTransport.subscribe(
				(logEvent: LogStreamEvent) => {
					if (shouldIncludeLevel(logEvent.level, input.level)) {
						logQueue.push(logEvent);
						if (resolve) {
							resolve();
							resolve = null;
						}
					}
				},
			);

			try {
				while (true) {
					if (logQueue.length > 0) {
						yield logQueue.shift()!;
					} else {
						await new Promise<void>((res) => {
							resolve = res;
						});
					}
				}
			} finally {
				unsubscribe();
			}
		}),
});
