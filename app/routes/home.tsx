import type { Route } from "./+types/home";
import { ConfigurationPage } from "../configuration/configuration";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Crowdsec remediation component for Cloudflare Workers" },
		{ name: "description", content: "Deploy your Crowdsec remediation component for Cloudflare Workers" },
	];
}

export function loader({ context }: Route.LoaderArgs) {
	return {  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
	return <ConfigurationPage />;
}
