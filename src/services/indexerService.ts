import { z } from "zod";
import { db } from "../db.js";
import { Label, logger } from "../logger.js";
import { assembleUrl } from "../torznab.js";
import { USER_AGENT } from "../constants.js";
import { getAllIndexers, type Indexer } from "../indexers.js";
import ms from "ms";

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
) {
	try {
		const response = await fetch(assembleUrl(url, apikey, { t: "caps" }), {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(ms("5 seconds")),
		});

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error("Authentication failed - check API key");
			} else if (response.status === 429) {
				throw new Error("Rate limited by indexer");
			} else {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`,
				);
			}
		}

		logger.info({
			label: Label.TORZNAB,
			message: `Test connection successful for: ${name}`,
		});

		return {
			success: true,
			message: "Connection successful",
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown error";

		logger.warn({
			label: Label.TORZNAB,
			message: `Test connection failed for ${name}: ${message}`,
		});

		return {
			success: false,
			message: `Connection failed: ${message}`,
		};
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
) {
	const { id, ...updates } = input;

	// Prepare update object
	const updateData = {
		...(updates.name !== undefined && { name: updates.name }),
		...(updates.url !== undefined && { url: updates.url }),
		...(updates.apikey !== undefined && { apikey: updates.apikey }),
		...(updates.active !== undefined && { active: updates.active }),
	};

	// Atomic update with existence check
	const [updatedIndexer] = await db("indexer")
		.where({ id })
		.update(updateData)
		.returning("*");

	if (!updatedIndexer) {
		throw new Error(`Indexer with ID ${id} not found`);
	}

	logger.info({
		label: Label.TORZNAB,
		message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
	});

	return updatedIndexer;
}

export async function deactivateIndexer(id: number) {
	// Soft delete - set active to false instead of actually deleting
	// This preserves cache data and download history
	const [deactivatedIndexer] = await db("indexer")
		.where({ id })
		.update({ active: false })
		.returning("*");

	if (!deactivatedIndexer) {
		throw new Error(`Indexer with ID ${id} not found`);
	}

	logger.info({
		label: Label.TORZNAB,
		message: `Deactivated indexer (set active=false): ${deactivatedIndexer.name || deactivatedIndexer.url}`,
	});

	return { success: true, indexer: deactivatedIndexer };
}

export async function getIndexerById(id: number) {
	const indexer = await db("indexer").where({ id }).first();

	if (!indexer) {
		throw new Error(`Indexer with ID ${id} not found`);
	}

	return indexer;
}

export async function listAllIndexers({
	includeInactive = false,
} = {}): Promise<Indexer[]> {
	return getAllIndexers({ includeInactive });
}

export async function testExistingIndexer(id: number) {
	const indexer = await getIndexerById(id);

	return testIndexerConnection(
		indexer.url,
		indexer.apikey,
		indexer.name || indexer.url,
	);
}

export async function testNewIndexer(input: z.infer<typeof indexerTestSchema>) {
	return testIndexerConnection(input.url, input.apikey, input.url);
}
