// tRPC's ESM WebSocket adapter refers to these types through the default
// export namespace. @types/ws exports them separately in its ESM declarations.
import type { WebSocket as Socket, WebSocketServer as Server } from "ws";
declare module "ws" {
	namespace WebSocket {
		type WebSocket = Socket;
		type WebSocketServer = Server;
	}
}
