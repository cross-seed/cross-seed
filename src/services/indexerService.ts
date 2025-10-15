import { z } from "zod";
import { db } from "../db.js";
import { Label, logger } from "../logger.js";
import { assembleUrl } from "../torznab.js";
import { USER_AGENT } from "../constants.js";
import {
	getAllIndexers,
	getArchivedIndexers,
	type Indexer,
} from "../indexers.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import ms from "ms";

// Helper function to deserialize raw database row (snake_case columns) to Indexer
function deserializeRawRow(rawRow: unknown): Indexer {
	const row = rawRow as Record<string, unknown>;
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		apikey: row.apikey,
		active: Boolean(row.active),
		enabled: Boolean(row.enabled),
		status: row.status,
		retryAfter: row.retry_after,
		searchCap: Boolean(row.search_cap),
		tvSearchCap: Boolean(row.tv_search_cap),
		movieSearchCap: Boolean(row.movie_search_cap),
		musicSearchCap: Boolean(row.music_search_cap),
		audioSearchCap: Boolean(row.audio_search_cap),
		bookSearchCap: Boolean(row.book_search_cap),
		tvIdCaps: row.tv_id_caps ? JSON.parse(row.tv_id_caps as string) : null,
		movieIdCaps: row.movie_id_caps
			? JSON.parse(row.movie_id_caps as string)
			: null,
		categories: row.cat_caps ? JSON.parse(row.cat_caps as string) : null,
		limits: row.limits_caps ? JSON.parse(row.limits_caps as string) : null,
	} as Indexer;
}

// Validation schemas
export const indexerCreateSchema = z.object({
	name: z.string().min(1).optional(),
	url: z.string().url(),
	apikey: z.string().min(1),
	active: z.boolean().optional().default(true),
	enabled: z.boolean().default(true),
});

export const indexerUpdateSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().min(1).optional().nullable(),
	url: z.string().url().optional(),
	apikey: z.string().min(1).optional(),
	enabled: z.boolean().optional(),
});

export const indexerTestSchema = z.object({
	url: z.string().url(),
	apikey: z.string().min(1),
});

// Service functions
export type TestConnectionError = {
	code: "CONNECTION_FAILED" | "TIMEOUT" | "AUTH_FAILED" | "RATE_LIMITED";
	message: string;
};

export type IndexerNotFoundError = {
	code: "INDEXER_NOT_FOUND";
	message: string;
};

export async function testIndexerConnection(
	url: string,
	apikey: string,
	name: string,
): Promise<Result<{ success: true; message: string }, TestConnectionError>> {
	try {
		const response = await fetch(assembleUrl(url, apikey, { t: "caps" }), {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(ms("5 seconds")),
		});

		if (!response.ok) {
			if (response.status === 401) {
				return resultOfErr({
					code: "AUTH_FAILED",
					message: "Authentication failed - check API key",
				});
			} else if (response.status === 429) {
				return resultOfErr({
					code: "RATE_LIMITED",
					message: "Rate limited by indexer",
				});
			} else {
				return resultOfErr({
					code: "CONNECTION_FAILED",
					message: "Connection failed",
				});
			}
		}

		logger.verbose({
			label: Label.TORZNAB,
			message: `Test connection successful for: ${name}`,
		});

		return resultOf({
			success: true,
			message: "Connection successful",
		});
	} catch (error) {
		const message = error.message;

		logger.warn({
			label: Label.TORZNAB,
			message: `Test connection failed for ${name}: ${message}`,
		});

		// Handle timeout specifically - AbortSignal.timeout() throws TimeoutError (DOMException)
		if (error.name === "TimeoutError" || error.name === "AbortError") {
			return resultOfErr({
				code: "TIMEOUT",
				message: "Connection timed out",
			});
		}

		return resultOfErr({
			code: "CONNECTION_FAILED",
			message: "Connection failed",
		});
	}
}

export async function createIndexer(
	input: z.infer<typeof indexerCreateSchema>,
): Promise<Indexer> {
	// Create new indexer only (no upsert)
	const [result] = await db("indexer")
		.insert({
			name: input.name || null,
			url: input.url,
			apikey: input.apikey,
			trackers: null,
			active: true,
			enabled: input.enabled,
			status: null,
			retry_after: null,
			search_cap: null,
			tv_search_cap: null,
			movie_search_cap: null,
			music_search_cap: null,
			audio_search_cap: null,
			book_search_cap: null,
			tv_id_caps: null,
			movie_id_caps: null,
			cat_caps: null,
			limits_caps: null,
		})
		.returning("id");

	// Query the created record
	const rawRow = await db("indexer").where({ id: result.id }).first();

	const indexer = deserializeRawRow(rawRow);

	logger.verbose({
		label: Label.TORZNAB,
		message: `Created indexer: ${input.name || input.url}`,
	});

	return indexer;
}

export async function updateIndexer(
	input: z.infer<typeof indexerUpdateSchema>,
): Promise<Result<Indexer, IndexerNotFoundError>> {
	const { id, ...updates } = input;

	// Prepare update object
	const updateData = {
		...(updates.name !== undefined && { name: updates.name }),
		...(updates.url !== undefined && { url: updates.url }),
		...(updates.apikey !== undefined && { apikey: updates.apikey }),
		...(updates.enabled !== undefined && { enabled: updates.enabled }),
	};

	// Atomic update with existence check
	const updateCount = await db("indexer")
		.where({ id, active: true })
		.update(updateData);

	if (updateCount === 0) {
		return resultOfErr({
			code: "INDEXER_NOT_FOUND",
			message: `Indexer with ID ${id} not found`,
		});
	}

	// Query the updated record
	const updatedRawRow = await db("indexer").where({ id }).first();

	const updatedIndexer = deserializeRawRow(updatedRawRow);
	logger.verbose({
		label: Label.TORZNAB,
		message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
	});

	return resultOf(updatedIndexer);
}

export async function deactivateIndexer(
	id: number,
): Promise<Result<{ success: true; indexer: Indexer }, IndexerNotFoundError>> {
	// Soft delete - set active to false instead of actually deleting
	// This preserves cache data and download history
	const updateCount = await db("indexer")
		.where({ id, active: true })
		.update({ active: false });

	if (updateCount === 0) {
		return resultOfErr({
			code: "INDEXER_NOT_FOUND",
			message: `Indexer with ID ${id} not found`,
		});
	}

	// Query the updated record
	const deactivatedRawRow = await db("indexer").where({ id }).first();

	const deactivatedIndexer = deserializeRawRow(deactivatedRawRow);
	logger.verbose({
		label: Label.TORZNAB,
		message: `Deactivated indexer (set active=false): ${deactivatedIndexer.name || deactivatedIndexer.url}`,
	});

	return resultOf({ success: true, indexer: deactivatedIndexer });
}

export async function getIndexerById(
	id: number,
): Promise<Result<Indexer, IndexerNotFoundError>> {
	const rawRow = await db("indexer").where({ id, active: true }).first();

	if (!rawRow) {
		return resultOfErr({
			code: "INDEXER_NOT_FOUND",
			message: `Indexer with ID ${id} not found`,
		});
	}

	return resultOf(deserializeRawRow(rawRow));
}

// TODO: This is a thin wrapper around getAllIndexers from ../indexers.js
// Consider consolidating duplicate functionality between indexerService and indexers modules
export async function listAllIndexers(): Promise<Indexer[]> {
	return getAllIndexers();
}

export async function listArchivedIndexers(): Promise<Indexer[]> {
	return getArchivedIndexers();
}

export async function testExistingIndexer(
	id: number,
): Promise<
	Result<
		{ success: true; message: string },
		IndexerNotFoundError | TestConnectionError
	>
> {
	const indexerResult = await getIndexerById(id);
	if (indexerResult.isErr()) {
		return indexerResult;
	}

	const indexer = indexerResult.unwrap();
	return testIndexerConnection(
		indexer.url,
		indexer.apikey,
		indexer.name || indexer.url,
	);
}

export async function testNewIndexer(
	input: z.infer<typeof indexerTestSchema>,
): Promise<Result<{ success: true; message: string }, TestConnectionError>> {
	return testIndexerConnection(input.url, input.apikey, input.url);
}
