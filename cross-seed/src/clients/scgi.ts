import ms from "ms";
import { createConnection, type NetConnectOpts } from "net";
import { Readable } from "stream";
import Deserializer from "xmlrpc/lib/deserializer.js";
import { serializeMethodCall } from "xmlrpc/lib/serializer.js";
import { CrossSeedError } from "../errors.js";

const SCGI_PROTOCOL = "scgi:";
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");
const NUL = "\0";
const IDLE_TIMEOUT = ms("2 minutes");

export function parseScgiUrl(url: string): URL | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === SCGI_PROTOCOL ? parsed : null;
	} catch {
		return null;
	}
}

/** The endpoint without userinfo: these strings reach the log and the Web UI. */
function describeEndpoint(url: URL): string {
	return `${url.protocol}//${url.host}${url.pathname}`;
}

export interface ScgiClientOptions {
	/** Prefixes configuration errors, matching the other clients' log format. */
	label?: string;
	/** Overridable so tests need not wait out the real interval. */
	idleTimeout?: number;
}

export interface RpcTransport {
	methodCall(
		method: string,
		params: unknown[],
		callback: (error: unknown, value: unknown) => void,
	): void;
}

export function scgiConnectOptions(url: URL, label?: string): NetConnectOpts {
	if (!url.host) {
		return { path: decodeURIComponent(url.pathname) };
	}
	if (!url.port) {
		throw new CrossSeedError(
			`${label ? `[${label}] ` : ""}SCGI url ${describeEndpoint(url)} needs a port: use scgi://host:port for an rTorrent network.scgi.open_port, or scgi:///path/to/socket for network.scgi.open_local`,
		);
	}
	return {
		host: url.hostname.replace(/^\[|\]$/g, ""),
		port: Number(url.port),
	};
}

export function encodeScgiRequest(payload: Buffer): Buffer {
	const headers = Buffer.from(
		["CONTENT_LENGTH", String(payload.length), "SCGI", "1"]
			.map((field) => field + NUL)
			.join(""),
		"utf8",
	);
	return Buffer.concat([
		Buffer.from(`${headers.length}:`),
		headers,
		Buffer.from(","),
		payload,
	]);
}

export function createScgiClient(
	url: URL,
	{ label, idleTimeout = IDLE_TIMEOUT }: ScgiClientOptions = {},
): RpcTransport {
	const options = scgiConnectOptions(url, label);
	return {
		methodCall(method, params, callback) {
			let payload: Buffer;
			try {
				payload = Buffer.from(
					serializeMethodCall(method, params),
					"utf8",
				);
			} catch (error) {
				callback(error, undefined);
				return;
			}

			const chunks: Buffer[] = [];
			const socket = createConnection(options);
			let settled = false;
			const settle = (error: unknown, value?: unknown): void => {
				if (settled) return;
				settled = true;
				socket.destroy();
				callback(error, value);
			};

			socket.setTimeout(idleTimeout, () => {
				settle(
					new Error(
						`SCGI request to ${describeEndpoint(url)} timed out after ${ms(idleTimeout, { long: true })} of inactivity`,
					),
				);
			});
			socket.on("error", settle);
			socket.on("data", (chunk: Buffer) => chunks.push(chunk));
			socket.on("end", () => {
				const response = Buffer.concat(chunks);
				const separator = response.indexOf(HEADER_SEPARATOR);
				if (separator === -1) {
					settle(
						new Error(
							`Malformed SCGI response from ${describeEndpoint(url)}`,
						),
					);
					return;
				}
				new Deserializer().deserializeMethodResponse(
					Readable.from([
						response.subarray(separator + HEADER_SEPARATOR.length),
					]),
					settle,
				);
			});
			socket.write(encodeScgiRequest(payload));
		},
	};
}
