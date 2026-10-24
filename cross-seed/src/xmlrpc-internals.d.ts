declare module "xmlrpc/lib/serializer.js" {
	export function serializeMethodCall(
		method: string,
		params?: unknown[],
		encoding?: string,
	): string;
}

declare module "xmlrpc/lib/deserializer.js" {
	import type { Readable } from "stream";

	export default class Deserializer {
		constructor(encoding?: string);
		deserializeMethodResponse(
			stream: Readable,
			callback: (error: unknown, value: unknown) => void,
		): void;
	}
}
