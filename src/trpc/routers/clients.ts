import { z } from "zod";
import { router, authedProcedure } from "../index.js";
import { db } from "../../db.js";
import { Label, logger } from "../../logger.js";
import { sanitizeUrl } from "../../utils.js";
import { USER_AGENT } from "../../constants.js";
import ms from "ms";
// import { getAllClients } from "../../clients.js";

const clientCreateSchema = z.object({
	name: z.string().min(1).optional(),
	url: z.string().url(),
	client: z.enum(["qbittorrent", "rtorrent", "transmission", "deluge"]),
	username: z.string().min(1),
	password: z.string().min(1),
	readOnly: z.boolean().optional().default(false),
});

const clientUpdateSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().min(1).optional(),
	url: z.string().url(),
	client: z.string().min(1),
	username: z.string().min(1),
	password: z.string().min(1),
	readOnly: z.boolean().optional().default(false),
	active: z.boolean().optional(),
});

function getClientLabel(name: string) {
	switch (name) {
		case "qbittorrent":
			return Label.QBITTORRENT;
		case "rtorrent":
			return Label.RTORRENT;
		case "transmission":
			return Label.TRANSMISSION;
		case "deluge":
			return Label.DELUGE;
		default:
			return Label.TORZNAB;
	}
}

// TODO use it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testConnection(
	url: string,
	username: string,
	password: string,
	name: string,
) {
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(ms("30 seconds")),
		});

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error("Authentication failed");
			} else {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`,
				);
			}
		}

		logger.info({
			label: getClientLabel(name),
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
			label: getClientLabel(name),
			message: `Test connection failed for ${name}: ${message}`,
		});

		return {
			success: false,
			message: `Connection failed: ${message}`,
		};
	}
}

export const clientsRouter = router({
	// Create new client
	create: authedProcedure
		.input(clientCreateSchema)
		.mutation(async ({ input }) => {
			const sanitizedUrl = sanitizeUrl(input.url);

			// Check if client already exists
			const existing = await db("client")
				.where({ url: sanitizedUrl })
				.first();

			if (existing) {
				throw new Error(
					`client with URL ${sanitizedUrl} already exists`,
				);
			}

			const [client] = await db("client")
				.insert({
					name: input.name || null,
					url: sanitizedUrl,
					active: true,
					client: input.client,
					username: input.username,
					password: input.password,
					readOnly: input.readOnly,
				})
				.returning("*");

			logger.info({
				label: getClientLabel(input.client),
				message: `Created new client: ${input.name || sanitizedUrl}`,
			});

			return client;
		}),

	// Update client
	update: authedProcedure
		.input(clientUpdateSchema)
		.mutation(async ({ input }) => {
			const { id, ...updates } = input;

			// Check if client exists
			const existing = await db("client").where({ id }).first();

			if (!existing) {
				throw new Error(`client with ID ${id} not found`);
			}

			// Prepare update object
			const updateData = {
				...(updates.name !== undefined && { name: updates.name }),
				...(updates.url !== undefined && {
					url: sanitizeUrl(updates.url),
				}),
				...(updates.active !== undefined && { active: updates.active }),
				...(updates.client !== undefined && { client: updates.client }),
				...(updates.username !== undefined && {
					username: updates.username,
				}),
				...(updates.password !== undefined && {
					password: updates.password,
				}),
				...(updates.readOnly !== undefined && {
					readOnly: updates.readOnly,
				}),
			};

			const [updatedclient] = await db("client")
				.where({ id })
				.update(updateData)
				.returning("*");

			logger.info({
				label: Label.TORZNAB,
				message: `Updated client: ${updatedclient.name || updatedclient.url}`,
			});

			return updatedclient;
		}),

	// Delete client
	delete: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			const existing = await db("client").where({ id: input.id }).first();

			if (!existing) {
				throw new Error(`client with ID ${input.id} not found`);
			}

			await db("client").where({ id: input.id }).del();

			logger.info({
				label: Label.TORZNAB,
				message: `Deleted client: ${existing.name || existing.url}`,
			});

			return { success: true };
		}),

	// Test existing client connection
	testExisting: authedProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ input }) => {
			const client = await db("client").where({ id: input.id }).first();

			if (!client) {
				throw new Error(`client with ID ${input.id} not found`);
			}

			// return testConnection(
			// 	client.url,
			// 	client.username,
			// 	client.password,
			// 	client.name || client.url,
			// );
		}),

	// Test new client connection before creating
	// testNew: authedProcedure
	// 	.input(
	// 		z.object({
	// 			url: z.string().url(),
	// 			apikey: z.string().min(1),
	// 		}),
	// 	)
	// 	.mutation(async ({ input }) => {
	// 		const testUrl = sanitizeUrl(input.url);
	// 		return testConnection(testUrl, input.apikey, testUrl);
	// 	}),
});
