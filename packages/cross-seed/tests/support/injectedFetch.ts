type FetchInput = string | URL | Request;
type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>;
type InjectResponse = {
	statusCode: number;
	headers: Record<string, string | string[] | number | undefined>;
	payload: string;
	rawPayload?: Buffer;
};
type InjectServer = {
	inject: (options: {
		method?: string;
		url: string;
		headers?: Record<string, string>;
		payload?: Buffer;
	}) => Promise<InjectResponse>;
};

export type InjectedFetchOptions = {
	server: InjectServer;
	baseUrl: string;
	realFetch?: FetchLike;
};

function headersToObject(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

function applyResponseHeaders(
	resHeaders: Record<string, string | string[] | number | undefined>,
): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(resHeaders)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(key, String(entry));
			}
		} else {
			headers.set(key, String(value));
		}
	}
	return headers;
}

export function createInjectedFetch(
	options: InjectedFetchOptions,
): typeof fetch {
	const baseOrigin = new URL(options.baseUrl).origin;
	const realFetch =
		options.realFetch ?? ((input, init) => globalThis.fetch(input, init));

	return (async (input: FetchInput, init?: RequestInit) => {
		const request =
			input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);

		if (url.origin !== baseOrigin) {
			return realFetch(input, init);
		}

		const method = init?.method ?? request.method;
		const headers = headersToObject(
			init?.headers ? new Headers(init.headers) : request.headers,
		);
		headers.host ??= url.host;
		headers["x-forwarded-host"] ??= url.host;
		headers["x-forwarded-proto"] ??= url.protocol.slice(0, -1);

		let payload: Buffer | undefined;
		if (method !== "GET" && method !== "HEAD") {
			const body = init?.body;
			if (body instanceof ArrayBuffer) {
				payload = Buffer.from(body);
			} else if (body instanceof Uint8Array) {
				payload = Buffer.from(body);
			} else if (typeof body === "string") {
				payload = Buffer.from(body);
			} else if (body) {
				payload = Buffer.from(await request.arrayBuffer());
			}
		}

		const res = await options.server.inject({
			method,
			url: `${url.pathname}${url.search}`,
			headers,
			payload,
		});

		const responseHeaders = applyResponseHeaders(res.headers);
		const responseBody = res.rawPayload ?? res.payload;

		return new Response(responseBody, {
			status: res.statusCode,
			headers: responseHeaders,
		});
	}) as typeof fetch;
}
