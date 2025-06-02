import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ms from "ms";

interface LogEntry {
	timestamp: string;
	level: string;
	label: string;
	message: string;
}

function formatRelativeTime(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();

	// More than 7 days, fall back to absolute date
	if (Math.abs(diffInMs) > ms("7d")) {
		return date.toLocaleDateString("en", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	// Use ms to format the difference
	const formatted = ms(Math.ceil(diffInMs / 1000) * 1000, { long: true });
	const [number, unit] = formatted.split(" ");

	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

	return rtf.format(-parseInt(number), unit as Intl.RelativeTimeFormatUnit);
}

export function Logs() {
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [levelFilters, setLevelFilters] = useState<Set<string>>(
		new Set(["error", "warn", "info", "verbose", "debug"]),
	);
	const [labelFilters, setLabelFilters] = useState<Set<string>>(new Set());
	const trpc = useTRPC();
	const tableRef = useRef<HTMLTableElement>(null);
	useSubscription(
		trpc.logs.subscribe.subscriptionOptions(
			{ limit: 100 },
			{
				enabled: true,
				onData: (newLog) => {
					setLogs((prev) => {
						const updated = [...prev, newLog];
						// Keep only last 500 logs to prevent memory issues
						return updated.slice(-500);
					});
				},
				onError: (err) => {
					console.error("Log subscription error:", err);
				},
			},
		),
	);

	// Detect if user is at bottom of page
	useEffect(() => {
		const handleScroll = () => {
			const position = window.innerHeight + window.scrollY;
			const height = document.documentElement.scrollHeight;
			const atBottom = position >= height;
			setIsAtBottom(atBottom);
		};

		window.addEventListener("scroll", handleScroll);
		handleScroll(); // Check initial state

		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	// Auto-scroll to bottom when new logs arrive and user is at bottom
	useLayoutEffect(() => {
		if (isAtBottom && logs.length > 0) {
			window.scrollTo({
				top: document.documentElement.scrollHeight,
				behavior: "instant",
			});
		}
	}, [logs, isAtBottom]);

	// Get unique labels from logs
	const uniqueLabels = useMemo(() => {
		const labels = new Set<string>();
		logs.forEach((log) => {
			if (log.label) {
				labels.add(log.label);
			}
		});
		return Array.from(labels).sort();
	}, [logs]);

	// Initialize label filters when new labels appear
	useEffect(() => {
		setLabelFilters((prev) => {
			const newFilters = new Set(prev);
			uniqueLabels.forEach((label) => newFilters.add(label));
			return newFilters;
		});
	}, [uniqueLabels]);

	// Filter logs based on level and label filters
	const filteredLogs = useMemo(() => {
		return logs.filter((log) => {
			const levelMatch = levelFilters.has(log.level);
			const labelMatch = !log.label || labelFilters.has(log.label);
			return levelMatch && labelMatch;
		});
	}, [logs, levelFilters, labelFilters]);

	return (
		<div className="space-y-6 w-full">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex flex-wrap items-center gap-2">
					{(
						["error", "warn", "info", "verbose", "debug"] as const
					).map((level) => (
						<Badge
							key={level}
							variant={
								levelFilters.has(level) ? "default" : "outline"
							}
							className={`hover:bg-muted cursor-pointer select-none ${
								level === "error"
									? levelFilters.has(level)
										? "bg-red-500 hover:bg-red-600"
										: "border-red-200 text-red-500"
									: level === "warn"
										? levelFilters.has(level)
											? "bg-yellow-500 hover:bg-yellow-600"
											: "border-yellow-200 text-yellow-500"
										: level === "info"
											? levelFilters.has(level)
												? "bg-blue-500 hover:bg-blue-600"
												: "border-blue-200 text-blue-500"
											: level === "verbose"
												? levelFilters.has(level)
													? "bg-gray-500 hover:bg-gray-600"
													: "border-gray-200 text-gray-500"
											: level === "debug"
												? levelFilters.has(level)
													? "bg-purple-500 hover:bg-purple-600"
													: "border-purple-200 text-purple-500"
												: ""
							}`}
							onClick={() => {
								setLevelFilters((prev) => {
									const newFilters = new Set(prev);
									if (newFilters.has(level)) {
										newFilters.delete(level);
									} else {
										newFilters.add(level);
									}
									return newFilters;
								});
							}}
						>
							{level}
						</Badge>
					))}
				</div>
				{uniqueLabels.length > 0 && (
					<div className="flex flex-wrap items-center gap-2">
						{uniqueLabels.map((label) => (
							<Badge
								key={label}
								variant={
									labelFilters.has(label)
										? "default"
										: "outline"
								}
								className="hover:bg-muted cursor-pointer font-mono text-xs select-none"
								onClick={() => {
									setLabelFilters((prev) => {
										const newFilters = new Set(prev);
										if (newFilters.has(label)) {
											newFilters.delete(label);
										} else {
											newFilters.add(label);
										}
										return newFilters;
									});
								}}
							>
								{label}
							</Badge>
						))}
					</div>
				)}
			</div>

			{filteredLogs.length > 0 ? (
				<div className="overflow-x-auto rounded-lg border">
					<Table ref={tableRef}>
						<TableHeader className="bg-muted sticky top-0 z-10">
							<TableRow className="border-b">
								<TableHead className="w-32">Time</TableHead>
								<TableHead className="w-24">Level</TableHead>
								<TableHead className="w-32">Label</TableHead>
								<TableHead>Message</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredLogs.map((log, index) => (
								<TableRow
									key={`${log.timestamp}-${index}`}
									className="hover:bg-muted/50 h-8"
								>
									<TableCell
										className="font-mono text-xs"
										title={new Date(
											log.timestamp,
										).toLocaleString()}
									>
										{formatRelativeTime(log.timestamp)}
									</TableCell>
									<TableCell className="py-1">
										<Badge
											variant={
												log.level === "error"
													? "destructive"
													: log.level === "warn"
														? "secondary"
														: log.level === "info"
															? "default"
															: log.level ===
																  "debug"
																? "outline"
																: "secondary"
											}
											className={
												log.level === "warn"
													? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
													: log.level === "info"
														? "bg-blue-500 text-white hover:bg-blue-600"
														: log.level === "verbose"
															? "bg-gray-500 text-white hover:bg-gray-600"
															: log.level === "debug"
																? "bg-purple-500 text-white hover:bg-purple-600"
																: ""
											}
										>
											{log.level}
										</Badge>
									</TableCell>
									<TableCell className="font-medium py-1">
										{log.label && (
											<Badge
												variant="outline"
												className="font-mono text-xs py-1"
											>
												{log.label}
											</Badge>
										)}
									</TableCell>
									<TableCell className="font-mono text-xs py-1">
										<div
											className="whitespace-pre-wrap"
											title={log.message}
										>
											{log.message}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : (
				<div className="text-muted-foreground items-center justify-center py-16">
					<div className="mb-2 flex items-center gap-2">
						<div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
						<span className="text-sm font-medium">
							{logs.length === 0
								? "Waiting for logs..."
								: "No logs match current filters"}
						</span>
					</div>
					{logs.length === 0 && (
						<p className="text-xs">
							Real-time streaming from server logs
						</p>
					)}
				</div>
			)}
		</div>
	);
}
