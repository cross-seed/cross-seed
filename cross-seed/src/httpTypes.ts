import type { HttpBindings } from "@hono/node-server";

export type HttpEnv = {
	Bindings: HttpBindings;
	Variables: { parsedBody: unknown };
};
