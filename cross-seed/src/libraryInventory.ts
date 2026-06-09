import { db } from "./db.js";
import type {
	File,
	SearcheeClient,
	SearcheeWithInfoHash,
	SearcheeWithoutInfoHash,
} from "./searchee.js";
import { inBatches } from "./utils.js";
import type { WithRequired } from "./utils.js";

export enum LibraryItemSource {
	CLIENT = "torrentClient",
	TORRENT = "torrentFile",
	DATA = "dataDir",
}

export enum LibraryScanStatus {
	RUNNING = "running",
	SUCCEEDED = "succeeded",
	FAILED = "failed",
}

export interface LibraryScan {
	id: number;
	source: LibraryItemSource;
	sourceInstance: string | null;
	status: LibraryScanStatus;
	startedAt: number;
	finishedAt: number | null;
	error: string | null;
	itemsSeen: number;
	itemsUpserted: number;
	itemsRemoved: number;
}

export interface LibraryItemInput {
	source: LibraryItemSource;
	sourceKey: string;
	sourceInstance?: string | null;
	clientHost?: string | null;
	infoHash?: string | null;
	path?: string | null;
	name: string;
	title: string;
	files: File[];
	length: number;
	savePath?: string | null;
	category?: string | null;
	tags?: string[] | null;
	trackers?: string[] | null;
	contentFingerprint?: string | null;
}

type SyncLibraryItemsOptions = {
	source: LibraryItemSource;
	sourceInstance?: string | null;
	itemsToUpsert?: LibraryItemInput[];
	sourceKeysSeen?: string[];
	pruneMissing?: boolean;
	now?: number;
};

interface LibraryScanRow {
	id: number;
	source: string;
	source_instance: string | null;
	status: string;
	started_at: number;
	finished_at: number | null;
	error: string | null;
	items_seen: number;
	items_upserted: number;
	items_removed: number;
}

function deserializeScan(row: LibraryScanRow): LibraryScan {
	return {
		id: row.id,
		source: row.source as LibraryItemSource,
		sourceInstance: row.source_instance,
		status: row.status as LibraryScanStatus,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		error: row.error,
		itemsSeen: row.items_seen,
		itemsUpserted: row.items_upserted,
		itemsRemoved: row.items_removed,
	};
}

export function createClientLibrarySourceKey(input: {
	clientHost: string;
	infoHash: string;
}): string {
	return `${LibraryItemSource.CLIENT}:${input.clientHost}:${input.infoHash}`;
}

export function createTorrentLibrarySourceKey(filePath: string): string {
	return `${LibraryItemSource.TORRENT}:${filePath}`;
}

export function createDataLibrarySourceKey(path: string): string {
	return `${LibraryItemSource.DATA}:${path}`;
}

function createContentFingerprint(input: {
	infoHash?: string | null;
	path?: string | null;
	name: string;
	title: string;
	files: File[];
	length: number;
	savePath?: string | null;
	category?: string | null;
	tags?: string[] | null;
	trackers?: string[] | null;
}): string {
	return JSON.stringify({
		infoHash: input.infoHash ?? null,
		path: input.path ?? null,
		name: input.name,
		title: input.title,
		files: input.files,
		length: input.length,
		savePath: input.savePath ?? null,
		category: input.category ?? null,
		tags: input.tags ?? null,
		trackers: input.trackers ?? null,
	});
}

export function createClientLibraryItemInput(
	searchee: SearcheeClient,
): LibraryItemInput {
	return {
		source: LibraryItemSource.CLIENT,
		sourceInstance: searchee.clientHost,
		sourceKey: createClientLibrarySourceKey({
			clientHost: searchee.clientHost,
			infoHash: searchee.infoHash,
		}),
		clientHost: searchee.clientHost,
		infoHash: searchee.infoHash,
		name: searchee.name,
		title: searchee.title,
		files: searchee.files,
		length: searchee.length,
		savePath: searchee.savePath,
		category: searchee.category ?? null,
		tags: searchee.tags ?? null,
		trackers: searchee.trackers,
		contentFingerprint: createContentFingerprint({
			infoHash: searchee.infoHash,
			name: searchee.name,
			title: searchee.title,
			files: searchee.files,
			length: searchee.length,
			savePath: searchee.savePath,
			category: searchee.category ?? null,
			tags: searchee.tags ?? null,
			trackers: searchee.trackers,
		}),
	};
}

export function createTorrentLibraryItemInput(
	searchee: SearcheeWithInfoHash,
	filePath: string,
	sourceInstance: string,
): LibraryItemInput {
	return {
		source: LibraryItemSource.TORRENT,
		sourceInstance,
		sourceKey: createTorrentLibrarySourceKey(filePath),
		infoHash: searchee.infoHash,
		path: filePath,
		name: searchee.name,
		title: searchee.title,
		files: searchee.files,
		length: searchee.length,
		category: searchee.category ?? null,
		tags: searchee.tags ?? null,
		trackers: searchee.trackers ?? null,
		contentFingerprint: createContentFingerprint({
			infoHash: searchee.infoHash,
			path: filePath,
			name: searchee.name,
			title: searchee.title,
			files: searchee.files,
			length: searchee.length,
			category: searchee.category ?? null,
			tags: searchee.tags ?? null,
			trackers: searchee.trackers ?? null,
		}),
	};
}

export function createDataLibraryItemInput(
	searchee: WithRequired<SearcheeWithoutInfoHash, "path">,
	sourceInstance: string,
): LibraryItemInput {
	return {
		source: LibraryItemSource.DATA,
		sourceInstance,
		sourceKey: createDataLibrarySourceKey(searchee.path),
		path: searchee.path,
		name: searchee.name,
		title: searchee.title,
		files: searchee.files,
		length: searchee.length,
		contentFingerprint: createContentFingerprint({
			path: searchee.path,
			name: searchee.name,
			title: searchee.title,
			files: searchee.files,
			length: searchee.length,
		}),
	};
}

export async function beginLibraryScan(input: {
	source: LibraryItemSource;
	sourceInstance?: string | null;
	now?: number;
}): Promise<LibraryScan> {
	const now = input.now ?? Date.now();
	const [scan] = await db("library_scan")
		.insert({
			source: input.source,
			source_instance: input.sourceInstance ?? null,
			status: LibraryScanStatus.RUNNING,
			started_at: now,
		})
		.returning("*");

	return deserializeScan(scan);
}

export async function getLibraryScan(id: number): Promise<LibraryScan | null> {
	const scan = await db("library_scan").where({ id }).first();
	return scan ? deserializeScan(scan) : null;
}

async function incrementScanCounts(
	scanId: number,
	counts: {
		itemsSeen?: number;
		itemsUpserted?: number;
		itemsRemoved?: number;
	},
): Promise<void> {
	await db("library_scan")
		.where({ id: scanId })
		.increment("items_seen", counts.itemsSeen ?? 0)
		.increment("items_upserted", counts.itemsUpserted ?? 0)
		.increment("items_removed", counts.itemsRemoved ?? 0);
}

export async function upsertLibraryItems(
	scanId: number,
	items: LibraryItemInput[],
	options: { now?: number } = {},
): Promise<void> {
	if (!items.length) return;

	const now = options.now ?? Date.now();
	const existingRows = await db("library_item")
		.whereIn(
			"source_key",
			items.map((item) => item.sourceKey),
		)
		.select("source_key", "content_fingerprint", "missing_since");
	const existingBySourceKey = new Map(
		existingRows.map((row) => [row.source_key, row]),
	);
	const unchangedSourceKeys: string[] = [];
	const changedItems = items.filter((item) => {
		const existing = existingBySourceKey.get(item.sourceKey);
		if (
			existing &&
			existing.missing_since === null &&
			existing.content_fingerprint === (item.contentFingerprint ?? null)
		) {
			unchangedSourceKeys.push(item.sourceKey);
			return false;
		}
		return true;
	});
	await markLibraryItemsSeen(scanId, unchangedSourceKeys, { now });
	if (!changedItems.length) return;

	const rows = changedItems.map((item) => ({
		source: item.source,
		source_instance: item.sourceInstance ?? null,
		source_key: item.sourceKey,
		client_host: item.clientHost ?? null,
		info_hash: item.infoHash ?? null,
		path: item.path ?? null,
		name: item.name,
		title: item.title,
		files: JSON.stringify(item.files),
		length: item.length,
		save_path: item.savePath ?? null,
		category: item.category ?? null,
		tags: item.tags ? JSON.stringify(item.tags) : null,
		trackers: item.trackers ? JSON.stringify(item.trackers) : null,
		content_fingerprint: item.contentFingerprint ?? null,
		first_seen_at: now,
		last_seen_at: now,
		last_indexed_at: now,
		missing_since: null,
		last_seen_scan_id: scanId,
		updated_at: now,
	}));

	await inBatches(rows, async (batch) => {
		await db("library_item")
			.insert(batch)
			.onConflict("source_key")
			.merge([
				"source",
				"source_instance",
				"client_host",
				"info_hash",
				"path",
				"name",
				"title",
				"files",
				"length",
				"save_path",
				"category",
				"tags",
				"trackers",
				"content_fingerprint",
				"last_seen_at",
				"last_indexed_at",
				"missing_since",
				"last_seen_scan_id",
				"updated_at",
			]);
	});
	await incrementScanCounts(scanId, {
		itemsSeen: changedItems.length,
		itemsUpserted: changedItems.length,
	});
}

export async function markLibraryItemsSeen(
	scanId: number,
	sourceKeys: string[],
	options: { now?: number } = {},
): Promise<void> {
	if (!sourceKeys.length) return;

	const now = options.now ?? Date.now();
	await inBatches(sourceKeys, async (batch) => {
		await db("library_item").whereIn("source_key", batch).update({
			last_seen_at: now,
			last_seen_scan_id: scanId,
			missing_since: null,
		});
	});
	await incrementScanCounts(scanId, { itemsSeen: sourceKeys.length });
}

export async function completeLibraryScan(
	scanId: number,
	options: { now?: number } = {},
): Promise<LibraryScan> {
	await db("library_scan")
		.where({ id: scanId })
		.update({
			status: LibraryScanStatus.SUCCEEDED,
			finished_at: options.now ?? Date.now(),
			error: null,
		});

	const scan = await getLibraryScan(scanId);
	if (!scan) throw new Error(`Library scan ${scanId} not found`);
	return scan;
}

export async function failLibraryScan(
	scanId: number,
	error: unknown,
	options: { now?: number } = {},
): Promise<LibraryScan> {
	await db("library_scan")
		.where({ id: scanId })
		.update({
			status: LibraryScanStatus.FAILED,
			finished_at: options.now ?? Date.now(),
			error: error instanceof Error ? error.message : String(error),
		});

	const scan = await getLibraryScan(scanId);
	if (!scan) throw new Error(`Library scan ${scanId} not found`);
	return scan;
}

export async function pruneMissingLibraryItems(
	scanId: number,
	options: { now?: number } = {},
): Promise<number> {
	const scan = await getLibraryScan(scanId);
	if (!scan) throw new Error(`Library scan ${scanId} not found`);
	if (scan.status !== LibraryScanStatus.SUCCEEDED) {
		throw new Error(
			`Cannot prune library items for ${scan.status} scan ${scanId}`,
		);
	}

	const now = options.now ?? Date.now();
	const query = db("library_item")
		.where({
			source: scan.source,
			missing_since: null,
		})
		.where((builder) => {
			if (scan.sourceInstance === null) {
				builder.whereNull("source_instance");
			} else {
				builder.where("source_instance", scan.sourceInstance);
			}
		})
		.where((builder) => {
			builder
				.whereNull("last_seen_scan_id")
				.orWhere("last_seen_scan_id", "!=", scanId);
		});
	const itemsRemoved = await query.update({
		missing_since: now,
		updated_at: now,
	});

	await incrementScanCounts(scanId, { itemsRemoved });
	return itemsRemoved;
}

export async function markLibraryItemsMissingBySourceKeys(
	sourceKeys: string[],
	options: { now?: number } = {},
): Promise<number> {
	if (!sourceKeys.length) return 0;

	let itemsRemoved = 0;
	const now = options.now ?? Date.now();
	await inBatches(sourceKeys, async (batch) => {
		itemsRemoved += await db("library_item")
			.whereIn("source_key", batch)
			.whereNull("missing_since")
			.update({
				missing_since: now,
				updated_at: now,
			});
	});
	return itemsRemoved;
}

export async function syncLibraryItems(
	options: SyncLibraryItemsOptions,
): Promise<LibraryScan> {
	const scan = await beginLibraryScan({
		source: options.source,
		sourceInstance: options.sourceInstance ?? null,
		now: options.now,
	});
	try {
		await upsertLibraryItems(scan.id, options.itemsToUpsert ?? [], {
			now: options.now,
		});
		await markLibraryItemsSeen(scan.id, options.sourceKeysSeen ?? [], {
			now: options.now,
		});
		const completedScan = await completeLibraryScan(scan.id, {
			now: options.now,
		});
		if (options.pruneMissing) {
			await pruneMissingLibraryItems(scan.id, { now: options.now });
			return (await getLibraryScan(scan.id)) ?? completedScan;
		}
		return completedScan;
	} catch (error) {
		await failLibraryScan(scan.id, error, { now: options.now });
		throw error;
	}
}
