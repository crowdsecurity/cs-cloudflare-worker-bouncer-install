/// <reference types="node" />
import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import type { Server } from "node:http";

/**
 * Plain Node has no runtime-native HTTP→WebSocket upgrade — @hono/node-ws
 * listens for the underlying http.Server's 'upgrade' event itself, so it
 * needs that server handed to it once listening has started.
 */
export function setupWs(app: Hono) {
	const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
	return {
		upgradeWebSocket,
		afterListen: (server: Server) => injectWebSocket(server),
	};
}
