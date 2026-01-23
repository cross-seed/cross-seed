import { promises as fs, watch } from "fs";
import { join } from "path";
import { appDir } from "../configuration.js";
import { logger } from "../logger.js";

export interface LogEntry {
	timestamp: string;
	level: string;
	label?: string;
	message: string;
}

type LogCallback = (log: LogEntry) => void;

function parseLocalTimestampToIso(timestamp: string): string {
	const match =
		/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/.exec(
			timestamp,
		);
	if (!match) {
		const parsed = new Date(timestamp);
		return Number.isNaN(parsed.getTime())
			? timestamp
			: parsed.toISOString();
	}
	const [, year, month, day, hour, minute, second, millisecond] = match;
	return new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
		millisecond ? Number(millisecond) : 0,
	).toISOString();
}

class LogWatcher {
	private watchers = new Map<string, ReturnType<typeof watch>>();
	private subscribers = new Set<LogCallback>();
	private lastPositions = new Map<string, number>();
	private retryTimers = new Map<string, NodeJS.Timeout>();

	constructor() {
		this.startWatching();
	}

	private startWatching() {
		const logFiles = ["verbose.current.log"];

		for (const fileName of logFiles) {
			const filePath = join(appDir(), "logs", fileName);
			this.watchLogFile(filePath);
		}
	}

	private watchLogFile(filePath: string) {
		// Initialize position to end of file (only watch new entries)
		void this.initializePosition(filePath);

		const clearRetryTimer = () => {
			const existingTimer = this.retryTimers.get(filePath);
			if (existingTimer) {
				clearTimeout(existingTimer);
				this.retryTimers.delete(filePath);
			}
		};

		const scheduleRetry = () => {
			if (this.retryTimers.has(filePath)) {
				return;
			}
			const timeout = setTimeout(() => {
				this.retryTimers.delete(filePath);
				this.watchLogFile(filePath);
			}, 1000);
			if (typeof timeout.unref === "function") {
				timeout.unref();
			}
			this.retryTimers.set(filePath, timeout);
		};

		try {
			const watcher = watch(filePath, (eventType) => {
				if (eventType === "change") {
					void this.handleFileChange(filePath);
				} else if (eventType === "rename") {
					// File was rotated or replaced - reset position and retry watching
					this.lastPositions.set(filePath, 0);
					this.watchers.get(filePath)?.close();
					this.watchers.delete(filePath);
					scheduleRetry();
				}
			});

			watcher.on("error", (error: NodeJS.ErrnoException) => {
				console.error(`Error watching ${filePath}:`, error);
				this.watchers.delete(filePath);
				if (error.code === "ENOENT") {
					scheduleRetry();
				}
			});

			clearRetryTimer();
			this.watchers.set(filePath, watcher);
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				scheduleRetry();
			} else {
				console.error(`Failed to watch ${filePath}:`, error);
			}
		}
	}

	private async initializePosition(filePath: string) {
		try {
			const stats = await fs.stat(filePath);
			this.lastPositions.set(filePath, stats.size);
		} catch (error) {
			// File doesn't exist yet, start from beginning
			this.lastPositions.set(filePath, 0);
		}
	}

	private async handleFileChange(filePath: string) {
		try {
			const stats = await fs.stat(filePath);
			const lastPosition = this.lastPositions.get(filePath) || 0;

			if (stats.size <= lastPosition) {
				// File was truncated or rotated, start from beginning
				this.lastPositions.set(filePath, 0);
				return;
			}

			// Read only the new content
			const stream = await fs.open(filePath, "r");
			const buffer = Buffer.alloc(stats.size - lastPosition);
			await stream.read(buffer, 0, buffer.length, lastPosition);
			await stream.close();

			const newContent = buffer.toString("utf8");
			const logEntries = this.parseLogContent(newContent);

			for (const logEntry of logEntries) {
				this.notifySubscribers(logEntry);
			}

			this.lastPositions.set(filePath, stats.size);
		} catch (error) {
			console.error(`Error reading ${filePath}:`, error);
		}
	}

	private parseLogContent(content: string): LogEntry[] {
		const logEntries: LogEntry[] = [];
		const lines = content.split("\n");
		let currentEntry: LogEntry | null = null;

		for (const line of lines) {
			if (!line.trim()) continue;

			const parsedEntry = this.tryParseLogLine(line);
			if (parsedEntry) {
				// This is a new log entry
				if (currentEntry) {
					logEntries.push(currentEntry);
				}
				currentEntry = parsedEntry;
			} else if (currentEntry) {
				// This is a continuation line (stack trace, etc.)
				currentEntry.message += "\n" + line;
			} else {
				// Orphan line with no preceding log entry
				logEntries.push({
					timestamp: new Date().toISOString(),
					level: "info",
					label: "raw",
					message: line,
				});
			}
		}

		if (currentEntry) {
			logEntries.push(currentEntry);
		}

		return logEntries;
	}

	private tryParseLogLine(line: string): LogEntry | null {
		// Parse winston text format: "2025-06-01 00:00:35.123 info: [scheduler] starting job: rss"
		const logRegex =
			/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?) (\w+):\s*(?:\[([^\]]+)\])?\s*(.*)$/;
		const match = line.match(logRegex);

		if (match) {
			const [, timestamp, level, label, message] = match;
			return {
				timestamp: parseLocalTimestampToIso(timestamp),
				level,
				label: label || undefined,
				message: message.trim(),
			};
		}

		return null;
	}

	private notifySubscribers(logEntry: LogEntry) {
		this.subscribers.forEach((callback) => {
			try {
				callback(logEntry);
			} catch (error) {
				console.error("Error in log subscriber:", error);
			}
		});
	}

	subscribe(callback: LogCallback): () => void {
		this.subscribers.add(callback);
		return () => this.subscribers.delete(callback);
	}

	async getRecentLogs(limit: number = 100): Promise<LogEntry[]> {
		const filePath = join(appDir(), "logs", "verbose.current.log");

		try {
			const fileContent = await fs.readFile(filePath, "utf-8");
			const allEntries = this.parseLogContent(fileContent);
			return allEntries.slice(-limit);
		} catch (error) {
			logger.error(`Error reading log file ${filePath}:`, error);
			return [];
		}
	}

	private shouldIncludeLevel(logLevel: string, filterLevel: string): boolean {
		const levels = ["error", "warn", "info", "verbose", "debug"];
		const logIndex = levels.indexOf(logLevel);
		const filterIndex = levels.indexOf(filterLevel);
		return logIndex <= filterIndex;
	}

	destroy() {
		for (const watcher of this.watchers.values()) {
			watcher.close();
		}
		this.watchers.clear();
		this.subscribers.clear();
		for (const timer of this.retryTimers.values()) {
			clearTimeout(timer);
		}
		this.retryTimers.clear();
	}
}

// Singleton instance
let logWatcher: LogWatcher | null = null;

export function getLogWatcher(): LogWatcher {
	if (!logWatcher) {
		logWatcher = new LogWatcher();
	}
	return logWatcher;
}

export function destroyLogWatcher() {
	if (logWatcher) {
		logWatcher.destroy();
		logWatcher = null;
	}
}
