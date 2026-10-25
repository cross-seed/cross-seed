import type { Context } from "hono";
import type { HttpEnv } from "../httpTypes.js";
import { checkApiKey } from "../auth.js";
import { Label, logger } from "../logger.js";

/** Legacy integrations accept either an X-Api-Key header or apikey query. */
export async function authorize(context: Context<HttpEnv>): Promise<boolean> {
	const apiKey =
		context.req.header("x-api-key") || context.req.query("apikey") || "";
	const authorized = await checkApiKey(apiKey);
	if (!authorized) {
		const ip =
			context.req.header("x-forwarded-for")?.split(",")[0] ||
			context.env?.incoming?.socket.remoteAddress;
		logger.error({
			label: Label.SERVER,
			message: `Unauthorized API access attempt to ${context.req.url} from ${ip}`,
		});
	}
	return authorized;
}

export const API_KEY_REQUIRED =
	"Specify the API key in an X-Api-Key header or an apikey query param.";
