import { authedProcedure, router } from "../index.js";
import { z } from "zod";
import QBittorrent from "../../clients/QBittorrent.js";
import RTorrent from "../../clients/RTorrent.js";
import Deluge from "../../clients/Deluge.js";
import Transmission from "../../clients/Transmission.js";

const testConnectionInputSchema = z.object({
	client: z.enum(["qbittorrent", "rtorrent", "transmission", "deluge"]),
	url: z.string().url(),
	username: z.string().optional(),
	password: z.string().optional(),
	readonly: z.boolean().default(false),
	plugin: z.boolean().default(false).optional(),
});

export const clientsRouter = router({
	testConnection: authedProcedure
		.input(testConnectionInputSchema)
		.mutation(async ({ input }) => {
			const { client: clientName, url, readonly } = input;

			const clientHost = new URL(url).host;

			let message = "";
			try {
				switch (clientName) {
					case "qbittorrent": {
						const qb = new QBittorrent(
							url,
							clientHost,
							0,
							readonly,
						);
						await qb.login();
						const prefs = await qb.getPreferences();
						if (
							prefs.bypass_auth_subnet_whitelist_enabled ||
							prefs.bypass_local_auth
						) {
							message =
								"Note: Credential validation requires qBittorrent's 'Bypass authentication for local auth' setting to be disabled.";
						} else {
							message = `Successfully connected to ${clientName}.`;
						}
						break;
					}
					case "rtorrent":
						await new RTorrent(
							url,
							clientHost,
							0,
							readonly,
						).validateConnection();
						break;
					case "transmission":
						await new Transmission(
							url,
							clientHost,
							0,
							readonly,
						).validateConfig();
						break;
					case "deluge":
						await new Deluge(
							url,
							clientHost,
							0,
							readonly,
						).authenticate();
						break;
				}

				return {
					success: true,
					message,
				};
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: String(error ?? "");
				throw new Error(`Connection test failed: ${message}`);
			}
		}),
});
