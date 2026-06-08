import type { Route } from "./+types/home";
import { InstallerPage } from "../configuration/installer";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "CrowdSec — Cloudflare Worker Bouncer Installer" },
		{ name: "description", content: "Deploy the CrowdSec remediation component for Cloudflare Workers" },
	];
}

export function loader({ context }: Route.LoaderArgs) {
	return {};
}

export default function Home({ loaderData }: Route.ComponentProps) {
	return <InstallerPage />;
}
