import { z } from "zod";
import { db } from "../db.js";
import { Label, logger } from "../logger.js";
import { sanitizeUrl } from "../utils.js";
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
			signal: AbortSignal.timeout(ms("30 seconds")),
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
	const sanitizedUrl = sanitizeUrl(input.url);

	// Check if indexer already exists
	const existing = await db("indexer").where({ url: sanitizedUrl }).first();

	if (existing) {
		// Upsert: update existing indexer and set active=true (reactivate if it was soft-deleted)
		const [updatedIndexer] = await db("indexer")
			.where({ url: sanitizedUrl })
			.update({
				name: input.name || existing.name,
				apikey: input.apikey,
				active: input.active ?? true,
			})
			.returning("*");

		logger.info({
			label: Label.TORZNAB,
			message: `Updated existing indexer (upsert): ${input.name || sanitizedUrl}`,
		});

		return updatedIndexer;
	}

	// Create new indexer
	const [indexer] = await db("indexer")
		.insert({
			name: input.name || null,
			url: sanitizedUrl,
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
		.returning("*");

	logger.info({
		label: Label.TORZNAB,
		message: `Created new indexer: ${input.name || sanitizedUrl}`,
	});

	return indexer;
}

export async function updateIndexer(
	input: z.infer<typeof indexerUpdateSchema>,
) {
	const { id, ...updates } = input;

	// Check if indexer exists
	const existing = await db("indexer").where({ id }).first();

	if (!existing) {
		throw new Error(`Indexer with ID ${id} not found`);
	}

	// Prepare update object
	const updateData = {
		...(updates.name !== undefined && { name: updates.name }),
		...(updates.url !== undefined && {
			url: sanitizeUrl(updates.url),
		}),
		...(updates.apikey !== undefined && { apikey: updates.apikey }),
		...(updates.active !== undefined && { active: updates.active }),
	};

	const [updatedIndexer] = await db("indexer")
		.where({ id })
		.update(updateData)
		.returning("*");

	logger.info({
		label: Label.TORZNAB,
		message: `Updated indexer: ${updatedIndexer.name || updatedIndexer.url}`,
	});

	return updatedIndexer;
}

export async function deleteIndexer(id: number) {
	const existing = await db("indexer").where({ id }).first();

	if (!existing) {
		throw new Error(`Indexer with ID ${id} not found`);
	}

	// Soft delete - set active to false instead of actually deleting
	// This preserves cache data and download history
	const [updatedIndexer] = await db("indexer")
		.where({ id })
		.update({ active: false })
		.returning("*");

	logger.info({
		label: Label.TORZNAB,
		message: `Soft deleted indexer (set active=false): ${existing.name || existing.url}`,
	});

	return { success: true, indexer: updatedIndexer };
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
	logger.debug({
		label: Label.TORZNAB,
		message: `cross-seed: listAllIndexers called with includeInactive=${includeInactive}`,
	});
	const result = await getAllIndexers({ includeInactive });
	logger.debug({
		label: Label.TORZNAB,
		message: `cross-seed: getAllIndexers returned ${result.length} indexers`,
	});
	return result;
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
	const testUrl = sanitizeUrl(input.url);
	return testIndexerConnection(testUrl, input.apikey, testUrl);
}
