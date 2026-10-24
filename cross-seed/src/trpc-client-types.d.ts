// tRPC's client declarations reference the browser RequestInfo alias, while
// Node exposes the underlying Request type without that alias.
declare global {
	type RequestInfo = string | Request;
}

// tRPC's ESM WebSocket adapter refers to these types through the default
// export namespace. @types/ws exports them separately in its ESM declarations.
import type { WebSocket as Socket, WebSocketServer as Server } from "ws";
declare module "ws" {
	namespace WebSocket {
		type WebSocket = Socket;
		type WebSocketServer = Server;
	}
}
