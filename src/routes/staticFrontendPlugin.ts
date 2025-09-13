import fastifyStatic from "@fastify/static";
import { FastifyInstance } from "fastify";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
console.log(import.meta.url);
const __dirname = dirname(__filename);

export async function staticFrontendPlugin(app: FastifyInstance) {
	const staticRoot = join(dirname(dirname(__dirname)), "dist", "webui");
	await app.register(fastifyStatic, {
		root: staticRoot,
		decorateReply: true,
	});

	app.setNotFoundHandler((_request, reply) => {
		return reply.sendFile("index.html", staticRoot);
	});
}
