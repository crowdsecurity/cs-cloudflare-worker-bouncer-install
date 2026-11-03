/// <reference types="node" />
import { serve } from "@hono/node-server";
import app, { afterListen } from "./app.js";

const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`Listening on http://localhost:${info.port}`);
});

// Wires up the http.Server's 'upgrade' event for the /ws route — see
// workers/ws-adapter.node.ts. No-op on the Workers build, which has no
// equivalent "after listen" moment (the runtime upgrades sockets natively).
afterListen(server);
