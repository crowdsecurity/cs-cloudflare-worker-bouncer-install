import type { Config } from "@react-router/dev/config";

// Shared by both build targets (there's only one react-router.config.ts).
// The Node build runs as a plain SPA — no server-rendering, since nothing in
// this app reads per-request data in a loader (confirmed: routes/home.tsx's
// loader is a no-op, entry.server.tsx's loadContext param is unused) — so it
// gets its own output directory and skips the SSR server-build entirely.
// The Cloudflare/Workers build (no BUILD_TARGET set) is untouched: ssr:true,
// default "build" directory, same as before this file had any conditionals.
const isNodeTarget = process.env.BUILD_TARGET === "node";

export default {
	ssr: !isNodeTarget,
	buildDirectory: isNodeTarget ? "build-node" : "build",
	future: {
		unstable_viteEnvironmentApi: true,
	},
} satisfies Config;
