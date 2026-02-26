import { useRef, useState } from "react";

type TurnstileConfig = { enabled: boolean; mode: "managed" | "non-interactive" | "invisible" };
type ZoneState = {
	id: string;
	domain: string;
	accountId: string;
	accountName: string;
	actions: string[];
	defaultAction: string;
	selected: boolean;
	routesToProtect: string[];
	turnstile: TurnstileConfig;
};
type ZonesResponse = { zones: ZoneState[] };
type ActionStatus = "idle" | "loading" | "success" | "error";

export function ConfigurationPage() {
	const [apiKey, setApiKey] = useState("");
	const [availableZones, setAvailableZones] = useState<ZoneState[]>([]);
	const [selectedZones, setSelectedZones] = useState<ZoneState[]>([]);
	const [crowdsecApiUrl, setCrowdsecApiUrl] = useState("");
	const [crowdsecApiKey, setCrowdsecApiKey] = useState("");
	const [zonesLoading, setZonesLoading] = useState(false);
	const [zonesError, setZonesError] = useState<string | null>(null);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [deployStatus, setDeployStatus] = useState<ActionStatus>("idle");
	const [deployError, setDeployError] = useState<string | null>(null);
	const [uninstallStatus, setUninstallStatus] = useState<ActionStatus>("idle");
	const [uninstallError, setUninstallError] = useState<string | null>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	function fetchZones(key: string) {
		if (!key.trim()) return;
		setZonesLoading(true);
		setZonesError(null);
		setAvailableZones([]);
		setSelectedZones([]);
		fetch("/zones", {
			headers: { Authorization: `Bearer ${key.trim()}` },
		})
			.then((res) => {
				if (!res.ok) return res.json().then((d) => Promise.reject(new Error((d as { error?: string }).error ?? `HTTP ${res.status}`)));
				return res.json() as Promise<ZonesResponse>;
			})
			.then((data) => setAvailableZones(data.zones))
			.catch((err) => setZonesError(err.message))
			.finally(() => setZonesLoading(false));
	}

	function toggleZone(zone: ZoneState) {
		setSelectedZones((prev) =>
			prev.some((z) => z.id === zone.id)
				? prev.filter((z) => z.id !== zone.id)
				: [...prev, zone],
		);
	}

	async function handleDeploy(e: React.FormEvent) {
		e.preventDefault();
		if (!apiKey.trim() || selectedZones.length === 0 || !crowdsecApiUrl.trim() || !crowdsecApiKey.trim()) return;
		setDeployStatus("loading");
		setDeployError(null);
		try {
			const res = await fetch("/configure", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey.trim()}`,
				},
				body: JSON.stringify({ zones: selectedZones, crowdsecApiUrl: crowdsecApiUrl.trim(), crowdsecApiKey: crowdsecApiKey.trim() }),
			});
			if (!res.ok) {
				const d = await res.json() as { error?: string };
				throw new Error(d.error ?? `HTTP ${res.status}`);
			}
			setDeployStatus("success");
		} catch (err: unknown) {
			setDeployError(err instanceof Error ? err.message : String(err));
			setDeployStatus("error");
		}
	}

	async function handleUninstall() {
		if (!apiKey.trim() || selectedZones.length === 0) return;
		setUninstallStatus("loading");
		setUninstallError(null);
		try {
			const res = await fetch("/clean", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey.trim()}`,
				},
				body: JSON.stringify({ zones: selectedZones }),
			});
			if (!res.ok) {
				const d = await res.json() as { error?: string };
				throw new Error(d.error ?? `HTTP ${res.status}`);
			}
			setUninstallStatus("success");
		} catch (err: unknown) {
			setUninstallError(err instanceof Error ? err.message : String(err));
			setUninstallStatus("error");
		}
	}

	const canDeploy =
		apiKey.trim() !== "" &&
		selectedZones.length > 0 &&
		crowdsecApiUrl.trim() !== "" &&
		crowdsecApiKey.trim() !== "" &&
		deployStatus !== "loading" &&
		uninstallStatus !== "loading";

	const canUninstall =
		apiKey.trim() !== "" &&
		selectedZones.length > 0 &&
		deployStatus !== "loading" &&
		uninstallStatus !== "loading";

	return (
		<div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
			<div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 space-y-6">
				<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
					CrowdSec Bouncer Setup
				</h1>

				<form onSubmit={handleDeploy} className="space-y-5">
					{/* Cloudflare API Key */}
					<div className="space-y-1">
						<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
							Cloudflare API Key
						</label>
						<input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							onBlur={() => fetchZones(apiKey)}
							placeholder="Enter your Cloudflare API token"
							className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
						{zonesLoading && (
							<p className="text-xs text-gray-500">Loading zones…</p>
						)}
						{zonesError && (
							<p className="text-xs text-red-500">{zonesError}</p>
						)}
					</div>

					{/* Zones multiselect */}
					<div className="space-y-1" ref={dropdownRef}>
						<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
							Zones
						</label>
						<div className="relative">
							<button
								type="button"
								disabled={availableZones.length === 0}
								onClick={() => setDropdownOpen((o) => !o)}
								className="w-full flex items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-left disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								<span className="text-gray-900 dark:text-gray-100 truncate">
									{selectedZones.length === 0
										? availableZones.length === 0
											? "Enter an API key to load zones"
											: "Select zones…"
										: selectedZones.map((z) => z.domain).join(", ")}
								</span>
								<svg className="ml-2 h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
								</svg>
							</button>
							{dropdownOpen && availableZones.length > 0 && (
								<div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-60 overflow-auto">
									{availableZones.map((zone) => (
										<label
											key={zone.id}
											className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
										>
											<input
												type="checkbox"
												checked={selectedZones.some((z) => z.id === zone.id)}
												onChange={() => toggleZone(zone)}
												className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
											/>
											<div className="flex flex-col min-w-0">
												<span className="text-sm text-gray-900 dark:text-gray-100 font-mono truncate">{zone.domain}</span>
												{zone.accountName && (
													<span className="text-xs text-gray-500 dark:text-gray-400 truncate">{zone.accountName}</span>
												)}
											</div>
										</label>
									))}
								</div>
							)}
						</div>
					</div>

					{/* CrowdSec API URL */}
					<div className="space-y-1">
						<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
							CrowdSec API Url
						</label>
						<input
							type="url"
							value={crowdsecApiUrl}
							onChange={(e) => setCrowdsecApiUrl(e.target.value)}
							placeholder="https://your-crowdsec-lapi:8080"
							className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>

					{/* CrowdSec API Key */}
				<div className="space-y-1">
					<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
						CrowdSec API Key
					</label>
					<input
						type="password"
						value={crowdsecApiKey}
						onChange={(e) => setCrowdsecApiKey(e.target.value)}
						placeholder="Enter your CrowdSec LAPI key"
						className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>

				{/* Submit */}
					{deployStatus === "success" && (
						<p className="text-sm text-green-600 dark:text-green-400">Deployed successfully.</p>
					)}
					{deployStatus === "error" && deployError && (
						<p className="text-sm text-red-500">{deployError}</p>
					)}
					{uninstallStatus === "success" && (
						<p className="text-sm text-green-600 dark:text-green-400">Uninstalled successfully.</p>
					)}
					{uninstallStatus === "error" && uninstallError && (
						<p className="text-sm text-red-500">{uninstallError}</p>
					)}
					<div className="flex gap-3">
						<button
							type="submit"
							disabled={!canDeploy}
							className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
						>
							{deployStatus === "loading" ? "Deploying…" : "Deploy"}
						</button>
						<button
							type="button"
							onClick={handleUninstall}
							disabled={!canUninstall}
							className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
						>
							{uninstallStatus === "loading" ? "Uninstalling…" : "Uninstall"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}