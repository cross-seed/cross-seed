import { authedProcedure, router } from "../index.js";
import { z } from "zod";
import QBittorrent from "../../clients/QBittorrent.js";

const testConnectionInputSchema = z.object({
	client: z.enum(["qbittorrent", "rtorrent", "transmission", "deluge"]),
	url: z.string().url(),
	username: z.string().optional(),
	password: z.string(),
	readonly: z.boolean().default(false),
});

export const clientsRouter = router({
	testConnection: authedProcedure
		.input(testConnectionInputSchema)
		.mutation(async ({ input }) => {
			const { client: clientName, url, readonly } = input;

			const clientHost = new URL(url).host;

			let client;
			try {
				switch (clientName) {
					case "qbittorrent": {
						client = new QBittorrent(url, clientHost, 0, readonly);
						break;
					}
					// Add cases for other clients (rtorrent, transmission, deluge) here
					default:
						throw new Error(
							`Unsupported client type: ${clientName}`,
						);
				}

				await client.login();
				const prefs = await client.getPreferences();
				if (
					prefs.bypass_auth_subnet_whitelist_enabled ||
					prefs.bypass_local_auth
				) {
					return {
						success: true,
						message:
							"Note: Credential validation requires qBittorrent's 'Bypass authentication for local auth' setting to be disabled.",
					};
				} else {
					return {
						success: true,
						message: `Successfully connected to ${clientName}.`,
					};
				}
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: String(error ?? "");
				throw new Error(`Connection test failed: ${message}`);
			}
		}),
});
