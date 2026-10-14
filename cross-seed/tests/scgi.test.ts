import { randomUUID } from "crypto";
import { createServer, type Server, type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createScgiClient,
	encodeScgiRequest,
	parseScgiUrl,
	scgiConnectOptions,
} from "../src/clients/scgi.js";
import { hostIdentity } from "../src/utils.js";

let server: Server | undefined;
const openSockets = new Set<Socket>();

afterEach(async () => {
	for (const socket of openSockets) socket.destroy();
	openSockets.clear();
	if (!server) return;
	const listening = server;
	server = undefined;
	await new Promise<void>((resolve) => listening.close(() => resolve()));
});

function decodeScgiRequest(request: Buffer): {
	headers: string[];
	body: string;
} {
	const colon = request.indexOf(":");
	const length = Number(request.subarray(0, colon).toString());
	return {
		headers: request
			.subarray(colon + 1, colon + 1 + length)
			.toString()
			.split("\0")
			.slice(0, -1),
		body: request.subarray(colon + 2 + length).toString(),
	};
}

function isCompleteScgiRequest(request: Buffer): boolean {
	const colon = request.indexOf(":");
	if (colon === -1) return false;
	const headerLength = Number(request.subarray(0, colon).toString());
	const bodyStart = colon + 2 + headerLength;
	if (request.length < bodyStart) return false;
	const [, contentLength] = request
		.subarray(colon + 1, colon + 1 + headerLength)
		.toString()
		.split("\0");
	return request.length >= bodyStart + Number(contentLength);
}

function methodResponse(inner: string): string {
	const body = `<?xml version="1.0"?><methodResponse>${inner}</methodResponse>`;
	return [
		"Status: 200 OK",
		"Content-Type: text/xml",
		`Content-Length: ${Buffer.byteLength(body)}`,
		"",
		body,
	].join("\r\n");
}

async function listen(
	respond: (request: Buffer) => string,
): Promise<{ url: URL; received: Buffer[] }> {
	const received: Buffer[] = [];
	const socketPath = join(
		tmpdir(),
		`cs-scgi-${randomUUID().slice(0, 8)}.sock`,
	);
	const created = createServer((socket) => {
		openSockets.add(socket);
		const chunks: Buffer[] = [];
		socket.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
			const request = Buffer.concat(chunks);
			if (!isCompleteScgiRequest(request)) return;
			received.push(request);
			socket.end(respond(request));
		});
	});
	server = created;
	await new Promise<void>((resolve) =>
		created.listen(socketPath, () => resolve()),
	);
	return { url: new URL(`scgi://${socketPath}`), received };
}

/** A server that accepts the connection and hands the raw socket over. */
async function listenRaw(
	handle: (socket: import("net").Socket) => void | Promise<void>,
): Promise<{ url: URL }> {
	const socketPath = join(
		tmpdir(),
		`cs-raw-${randomUUID().slice(0, 8)}.sock`,
	);
	const created = createServer((socket) => {
		openSockets.add(socket);
		void handle(socket);
	});
	server = created;
	await new Promise<void>((resolve) =>
		created.listen(socketPath, () => resolve()),
	);
	return { url: new URL(`scgi://${socketPath}`) };
}

function methodCallWithTimeout(
	url: URL,
	method: string,
	idleTimeout: number,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		createScgiClient(url, { idleTimeout }).methodCall(
			method,
			[],
			(error, value) => {
				if (error)
					reject(
						error instanceof Error
							? error
							: new Error(JSON.stringify(error)),
					);
				else resolve(value);
			},
		);
	});
}

function methodCall(url: URL, method: string, params: unknown[] = []) {
	return new Promise<unknown>((resolve, reject) => {
		createScgiClient(url).methodCall(method, params, (error, value) => {
			if (error)
				reject(
					error instanceof Error
						? error
						: new Error(JSON.stringify(error)),
				);
			else resolve(value);
		});
	});
}

describe("encodeScgiRequest", () => {
	it("frames the payload as a netstring with CONTENT_LENGTH first", () => {
		const request = encodeScgiRequest(Buffer.from("hello"));
		const { headers, body } = decodeScgiRequest(request);

		expect(headers).toEqual(["CONTENT_LENGTH", "5", "SCGI", "1"]);
		expect(body).toBe("hello");
	});

	it("terminates the netstring with a comma", () => {
		const nul = "\0";
		const request = encodeScgiRequest(Buffer.from("hi")).toString();

		expect(request).toBe(
			`24:CONTENT_LENGTH${nul}2${nul}SCGI${nul}1${nul},hi`,
		);
	});
});

describe("parseScgiUrl", () => {
	it("returns the url for unix socket and tcp scgi", () => {
		expect(parseScgiUrl("scgi:///run/rtorrent/.rpc.socket")?.pathname).toBe(
			"/run/rtorrent/.rpc.socket",
		);
		expect(parseScgiUrl("scgi://127.0.0.1:5000")?.host).toBe(
			"127.0.0.1:5000",
		);
	});

	it("returns null for non-scgi urls and garbage", () => {
		expect(parseScgiUrl("http://localhost:8080/RPC2")).toBeNull();
		expect(parseScgiUrl("https://user:pass@host/RPC2")).toBeNull();
		expect(parseScgiUrl("not a url")).toBeNull();
	});

	it("preserves a socket path that origin-based rebuilding would destroy", () => {
		const url = "scgi:///run/rtorrent/.rpc.socket";
		const parsed = new URL(url);

		expect(parsed.origin).toBe("null");
		expect(parsed.origin + parsed.pathname).toBe(
			"null/run/rtorrent/.rpc.socket",
		);
		expect(parseScgiUrl(url)!.href).toBe(url);
	});
});

describe("scgiConnectOptions", () => {
	it("uses a unix socket path when there is no host", () => {
		expect(
			scgiConnectOptions(new URL("scgi:///run/rtorrent/.rpc.socket")),
		).toEqual({ path: "/run/rtorrent/.rpc.socket" });
	});

	it("decodes percent-encoded socket paths", () => {
		expect(scgiConnectOptions(new URL("scgi:///run/my%20sock"))).toEqual({
			path: "/run/my sock",
		});
	});

	it("uses host and port for tcp scgi", () => {
		expect(scgiConnectOptions(new URL("scgi://127.0.0.1:5000"))).toEqual({
			host: "127.0.0.1",
			port: 5000,
		});
	});

	it("strips the brackets from an ipv6 literal", () => {
		// net resolves "[::1]" as a hostname and fails with ENOTFOUND
		expect(scgiConnectOptions(new URL("scgi://[::1]:5000"))).toEqual({
			host: "::1",
			port: 5000,
		});
	});

	it("rejects a tcp url without a port, naming both valid forms", () => {
		expect(() => scgiConnectOptions(new URL("scgi://127.0.0.1"))).toThrow(
			/needs a port.*open_port.*open_local/s,
		);
	});

	it("keeps credentials out of the error message", () => {
		expect(() =>
			scgiConnectOptions(new URL("scgi://user:sekrit@127.0.0.1")),
		).toThrow(/scgi:\/\/127\.0\.0\.1/);
		expect(() =>
			scgiConnectOptions(new URL("scgi://user:sekrit@127.0.0.1")),
		).not.toThrow(/sekrit/);
	});

	it("labels the missing-port error with the client", () => {
		expect(() =>
			scgiConnectOptions(new URL("scgi://127.0.0.1"), "rtorrent@x"),
		).toThrow(/^\[rtorrent@x\]/);
	});
});

describe("hostIdentity", () => {
	it("falls back to the path when a url has no host", () => {
		expect(hostIdentity(new URL("scgi:///run/rtorrent/.rpc.socket"))).toBe(
			"/run/rtorrent/.rpc.socket",
		);
	});

	it("leaves http clients on their host, unchanged", () => {
		expect(hostIdentity(new URL("http://localhost:8080/RPC2"))).toBe(
			"localhost:8080",
		);
		expect(hostIdentity(new URL("https://qbit.example.com/"))).toBe(
			"qbit.example.com",
		);
	});

	it("keeps two socket clients distinct", () => {
		expect(hostIdentity(new URL("scgi:///run/a.sock"))).not.toBe(
			hostIdentity(new URL("scgi:///run/b.sock")),
		);
	});
});

// The round-trip tests bind unix sockets, which Windows has no equivalent for.
describe.skipIf(process.platform === "win32")("createScgiClient", () => {
	it("round-trips a method call over a unix socket", async () => {
		const { url, received } = await listen(() =>
			methodResponse(
				"<params><param><value><string>0.9.8</string></value></param></params>",
			),
		);

		await expect(methodCall(url, "system.client_version")).resolves.toBe(
			"0.9.8",
		);
		expect(decodeScgiRequest(received[0]).body).toContain(
			"<methodName>system.client_version</methodName>",
		);
	});

	it("serializes params into the request body", async () => {
		const { url, received } = await listen(() =>
			methodResponse(
				"<params><param><value><i4>1</i4></value></param></params>",
			),
		);

		await methodCall(url, "d.custom1.set", ["ABC", "cross-seed"]);

		expect(decodeScgiRequest(received[0]).body).toContain(
			"<string>cross-seed</string>",
		);
	});

	it("surfaces xml-rpc faults as errors", async () => {
		const { url } = await listen(() =>
			methodResponse(
				"<fault><value><struct>" +
					"<member><name>faultCode</name><value><int>-501</int></value></member>" +
					"<member><name>faultString</name><value><string>Method not found</string></value></member>" +
					"</struct></value></fault>",
			),
		);

		await expect(methodCall(url, "nope")).rejects.toThrow(
			"Method not found",
		);
	});

	it("errors when the response has no header separator", async () => {
		const { url } = await listen(() => "garbage");

		await expect(methodCall(url, "system.client_version")).rejects.toThrow(
			/Malformed SCGI response/,
		);
	});

	it("reassembles a response split across multiple tcp chunks", async () => {
		const body = methodResponse(
			"<params><param><value><string>0.9.8</string></value></param></params>",
		);
		const { url } = await listenRaw(async (socket) => {
			for (const piece of [
				body.slice(0, 12),
				body.slice(12, 40),
				body.slice(40),
			]) {
				socket.write(piece);
				await new Promise((r) => setTimeout(r, 5));
			}
			socket.end();
		});

		await expect(methodCall(url, "system.client_version")).resolves.toBe(
			"0.9.8",
		);
	});

	it("times out instead of hanging when the peer never replies", async () => {
		const { url } = await listenRaw(() => {});

		await expect(
			methodCallWithTimeout(url, "system.client_version", 150),
		).rejects.toThrow(/timed out/);
	}, 10_000);

	it("errors when the socket does not exist", async () => {
		const url = new URL(
			`scgi://${join(tmpdir(), "cross-seed-absent.sock")}`,
		);

		await expect(methodCall(url, "system.client_version")).rejects.toThrow(
			/ENOENT/,
		);
	});
});
