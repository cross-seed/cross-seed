import { z } from "zod";
import { db } from "../db.js";
import { Label, logger } from "../logger.js";
import { assembleUrl } from "../torznab.js";
import { USER_AGENT } from "../constants.js";
import { getAllIndexers, type Indexer } from "../indexers.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import ms from "ms";

// Helper function to deserialize raw database row (snake_case columns) to Indexer
function deserializeRawRow(rawRow: Record<string, unknown>): Indexer {
	return {
		id: rawRow.id,
		name: rawRow.name,
		url: rawRow.url,
		apikey: rawRow.apikey,
		active: Boolean(rawRow.active),
		status: rawRow.status,
		retryAfter: rawRow.retry_after,
		searchCap: Boolean(rawRow.search_cap),
		tvSearchCap: Boolean(rawRow.tv_search_cap),
		movieSearchCap: Boolean(rawRow.movie_search_cap),
		musicSearchCap: Boolean(rawRow.music_search_cap),
		audioSearchCap: Boolean(rawRow.audio_search_cap),
		bookSearchCap: Boolean(rawRow.book_search_cap),
		tvIdCaps: rawRow.tv_id_caps
			? JSON.parse(rawRow.tv_id_caps as string)
			: null,
		movieIdCaps: rawRow.movie_id_caps
			? JSON.parse(rawRow.movie_id_caps as string)
			: null,
		categories: rawRow.cat_caps
			? JSON.parse(rawRow.cat_caps as string)
			: null,
		limits: rawRow.limits_caps
			? JSON.parse(rawRow.limits_caps as string)
			: null,
	} as Indexer;
}

// Validation schemas
export const indexerCreateSchema = z.object({
	name: z.string().min(1).optional(),
	url: z.string().url(),
	apikey: z.string().min(1),
	active: z.boolean().optional().default(true),
});

export const indexerUpdateSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().min(1).optional().nullable(),
	url: z.string().url().optional(),
	apikey: z.string().min(1).optional(),
	active: z.boolean().optional(),
});

export const indexerTestSchema = z.object({
	url: z.string().url(),
	apikey: z.string().min(1),
});

// Service functions
export type TestConnectionError =
	| "CONNECTION_FAILED"
	| "TIMEOUT"
	| "AUTH_FAILED"
	| "RATE_LIMITED";

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
				return resultOfErr("AUTH_FAILED");
			} else if (response.status === 429) {
				return resultOfErr("RATE_LIMITED");
			} else {
				return resultOfErr("CONNECTION_FAILED");
			}
		}

		logger.info({
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
			return resultOfErr("TIMEOUT");
		}

		return resultOfErr("CONNECTION_FAILED");
	}
}

export async function createIndexer(
	input: z.infer<typeof indexerCreateSchema>,
): Promise<Indexer> {
	// Use atomic upsert with .onConflict() clause
	const [result] = await db("indexer")
		.insert({
			name: input.name || null,
			url: input.url,
			apikey: input.apikey,
			active: input.active ?? true,
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
		.onConflict("url")
		.merge({
			name: input.name || db.raw("indexer.name"),
			apikey: input.apikey,
			active: input.active ?? true,
		})
		.returning("id");

	// Query the created/updated record
	const rawRow = await db("indexer").where({ id: result.id }).first();

	const indexer = deserializeRawRow(rawRow);

	logger.info({
		label: Label.TORZNAB,
		message: `Created/updated indexer: ${input.name || input.url}`,
	});

	return indexer;
}

export async function updateIndexer(
	input: z.infer<typeof indexerUpdateSchema>,
): Promise<Result<Indexer, "INDEXER_NOT_FOUND">> {
	const { id, ...updates } = input;

	// Prepare update object
	const updateData = {
		...(updates.name !== undefined && { name: updates.name }),
		...(updates.url !== undefined && { url: updates.url }),
		...(updates.apikey !== undefined && { apikey: updates.apikey }),
		...(updates.active !== undefined && { active: updates.active }),
	};

	// Atomic update with existence check
	const updateCount = await db("indexer").where({ id }).update(updateData);

	if (updateCount === 0) {
		return resultOfErr("INDEXER_NOT_FOUND");
	}

	// Query the updated record
	const updatedRawRow = await db("indexer").where({ id }).first();

	const updatedIndexer = deserializeRawRow(updatedRawRow);
	logger.info({
		label: Label.TORZNAB,
		message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
	});

	return resultOf(updatedIndexer);
}

export async function deactivateIndexer(
	id: number,
): Promise<Result<{ success: true; indexer: Indexer }, "INDEXER_NOT_FOUND">> {
	// Soft delete - set active to false instead of actually deleting
	// This preserves cache data and download history
	const updateCount = await db("indexer")
		.where({ id })
		.update({ active: false });

	if (updateCount === 0) {
		return resultOfErr("INDEXER_NOT_FOUND");
	}

	// Query the updated record
	const deactivatedRawRow = await db("indexer").where({ id }).first();

	const deactivatedIndexer = deserializeRawRow(deactivatedRawRow);
	logger.info({
		label: Label.TORZNAB,
		message: `Deactivated indexer (set active=false): ${deactivatedIndexer.name || deactivatedIndexer.url}`,
	});

	return resultOf({ success: true, indexer: deactivatedIndexer });
}

export async function getIndexerById(
	id: number,
): Promise<Result<Indexer, "INDEXER_NOT_FOUND">> {
	const rawRow = await db("indexer").where({ id }).first();

	if (!rawRow) {
		return resultOfErr("INDEXER_NOT_FOUND");
	}

	return resultOf(deserializeRawRow(rawRow));
}

// TODO: This is a thin wrapper around getAllIndexers from ../indexers.js
// Consider consolidating duplicate functionality between indexerService and indexers modules
export async function listAllIndexers({
	includeInactive = false,
} = {}): Promise<Indexer[]> {
	return getAllIndexers({ includeInactive });
}

export async function testExistingIndexer(
	id: number,
): Promise<
	Result<
		{ success: true; message: string },
		"INDEXER_NOT_FOUND" | TestConnectionError
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
