import { FastifyRequest, FastifyReply } from "fastify";
import { checkApiKey } from "../auth.js";
import { Label, logger } from "../logger.js";

/**
 * Checks all http API requests for authorized apiKey
 * uses param `?apikey=` or as header `x-api-key`
 */
export async function authorize(
	request: FastifyRequest<{
		Querystring: { apikey?: string };
	}>,
	reply: FastifyReply,
): Promise<boolean> {
	const apiKey =
		(request.headers["x-api-key"] as string) || request.query.apikey || "";
	const isAuthorized = await checkApiKey(apiKey);
	if (!isAuthorized) {
		const ipAddress =
			(request.headers["x-forwarded-for"] as string)
				?.split(",")
				.shift() || request.socket.remoteAddress;
		logger.error({
			label: Label.SERVER,
			message: `Unauthorized API access attempt to ${request.url} from ${ipAddress}`,
		});
		void reply
			.code(401)
			.send(
				"Specify the API key in an X-Api-Key header or an apikey query param.",
			);
	}
	return isAuthorized;
}
