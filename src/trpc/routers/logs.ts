import { z } from "zod";
import { authedProcedure, router } from "../index.js";
import { Label, logger } from "../../logger.js";
import { getLogWatcher, type LogEntry } from "../../utils/logWatcher.js";

export const logsRouter = router({
	getVerbose: authedProcedure.query(async () => {
		try {
			const logWatcher = getLogWatcher();
			const logs = await logWatcher.getRecentLogs(1000);
			// Convert back to text format for compatibility
			return logs
				.map(
					(log) =>
						`${log.timestamp} ${log.level}: ${log.label ? `[${log.label}] ` : ""}${log.message}`,
				)
				.join("\n");
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
				limit: z.number().min(1).max(1000).default(100),
			}),
		)
		.query(async ({ input }) => {
			try {
				const logWatcher = getLogWatcher();
				const logs = await logWatcher.getRecentLogs(input.limit);
				return logs.reverse(); // Return newest first
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
				limit: z.number().min(1).max(500).default(100),
			}),
		)
		.subscription(async function* ({ input }) {
			const logQueue: LogEntry[] = [];
			let resolve: (() => void) | null = null;

			// First, emit historical logs
			try {
				const logWatcher = getLogWatcher();
				const historicalLogs = await logWatcher.getRecentLogs(
					input.limit,
				);

				// Emit each historical log
				for (const log of historicalLogs) {
					// reverse to get oldest first
					yield log;
				}
			} catch (error) {
				logger.error({
					label: Label.SERVER,
					message: `Failed to load historical logs: ${error.message}`,
				});
			}

			// Then set up real-time streaming
			const logWatcher = getLogWatcher();
			const unsubscribe = logWatcher.subscribe((logEntry: LogEntry) => {
				logQueue.push(logEntry);
				if (resolve) {
					resolve();
					resolve = null;
				}
			});

			try {
				// Stream new logs indefinitely
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
