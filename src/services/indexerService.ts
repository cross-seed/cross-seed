import { z } from "zod";
import { db } from "../db.js";
import { Label, logger } from "../logger.js";
import { assembleUrl } from "../torznab.js";
import { USER_AGENT } from "../constants.js";
import {
	getAllIndexers,
	type Indexer,
	deserialize,
	type DbIndexer,
} from "../indexers.js";
import { Result, resultOf, resultOfErr } from "../Result.js";
import ms from "ms";

// Error handling types
export type IndexerErrorCode =
	| "INDEXER_NOT_FOUND"
	| "VALIDATION_ERROR"
	| "CONNECTION_FAILED"
	| "TIMEOUT"
	| "AUTH_FAILED"
	| "RATE_LIMITED"
	| "DATABASE_ERROR";

export type IndexerError = {
	code: IndexerErrorCode;
	message: string;
};

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
export async function testIndexerConnection(
	url: string,
	apikey: string,
	name: string,
): Promise<Result<{ success: true; message: string }, IndexerError>> {
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
					message: `HTTP ${response.status}: ${response.statusText}`,
				});
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
			return resultOfErr({
				code: "TIMEOUT",
				message: "Connection timed out",
			});
		}

		return resultOfErr({
			code: "CONNECTION_FAILED",
			message: `Connection failed: ${message}`,
		});
	}
}

export async function createIndexer(
	input: z.infer<typeof indexerCreateSchema>,
) {
	// Use atomic upsert with .onConflict() clause
	const [indexer] = await db("indexer")
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
		.returning("*");

	logger.info({
		label: Label.TORZNAB,
		message: `Created/updated indexer: ${input.name || input.url}`,
	});

	return indexer;
}

export async function updateIndexer(
	input: z.infer<typeof indexerUpdateSchema>,
): Promise<Result<Indexer, IndexerError>> {
	try {
		const { id, ...updates } = input;

		// Prepare update object
		const updateData = {
			...(updates.name !== undefined && { name: updates.name }),
			...(updates.url !== undefined && { url: updates.url }),
			...(updates.apikey !== undefined && { apikey: updates.apikey }),
			...(updates.active !== undefined && { active: updates.active }),
		};

		// Atomic update with existence check
		const updatedRows = await db("indexer")
			.where({ id })
			.update(updateData)
			.returning("*");

		const updatedDbIndexer = updatedRows[0] as unknown as DbIndexer;

		if (!updatedDbIndexer) {
			return resultOfErr({
				code: "INDEXER_NOT_FOUND",
				message: `Indexer with ID ${id} not found`,
			});
		}

		const updatedIndexer = deserialize(updatedDbIndexer);
		logger.info({
			label: Label.TORZNAB,
			message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
		});

		return resultOf(updatedIndexer);
	} catch (error) {
		return resultOfErr({
			code: "DATABASE_ERROR",
			message: `Failed to update indexer: ${error.message}`,
		});
	}
}

export async function deactivateIndexer(
	id: number,
): Promise<Result<{ success: true; indexer: Indexer }, IndexerError>> {
	try {
		// Soft delete - set active to false instead of actually deleting
		// This preserves cache data and download history
		const deactivatedRows = await db("indexer")
			.where({ id })
			.update({ active: false })
			.returning("*");

		const deactivatedDbIndexer = deactivatedRows[0] as unknown as DbIndexer;

		if (!deactivatedDbIndexer) {
			return resultOfErr({
				code: "INDEXER_NOT_FOUND",
				message: `Indexer with ID ${id} not found`,
			});
		}

		const deactivatedIndexer = deserialize(deactivatedDbIndexer);
		logger.info({
			label: Label.TORZNAB,
			message: `Deactivated indexer (set active=false): ${deactivatedIndexer.name || deactivatedIndexer.url}`,
		});

		return resultOf({ success: true, indexer: deactivatedIndexer });
	} catch (error) {
		return resultOfErr({
			code: "DATABASE_ERROR",
			message: `Failed to deactivate indexer: ${error.message}`,
		});
	}
}

export async function getIndexerById(
	id: number,
): Promise<Result<Indexer, IndexerError>> {
	try {
		const dbIndexer = (await db("indexer")
			.where({ id })
			.first()) as unknown as DbIndexer | undefined;

		if (!dbIndexer) {
			return resultOfErr({
				code: "INDEXER_NOT_FOUND",
				message: `Indexer with ID ${id} not found`,
			});
		}

		return resultOf(deserialize(dbIndexer));
	} catch (error) {
		return resultOfErr({
			code: "DATABASE_ERROR",
			message: `Failed to fetch indexer: ${error.message}`,
		});
	}
}

export async function listAllIndexers({
	includeInactive = false,
} = {}): Promise<Indexer[]> {
	return getAllIndexers({ includeInactive });
}

export async function testExistingIndexer(
	id: number,
): Promise<Result<{ success: true; message: string }, IndexerError>> {
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
): Promise<Result<{ success: true; message: string }, IndexerError>> {
	return testIndexerConnection(input.url, input.apikey, input.url);
}
