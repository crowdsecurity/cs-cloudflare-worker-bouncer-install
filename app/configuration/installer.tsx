import { useRef, useState } from "react";
import { T, TabBar, type TabKey, CfTokenSection, type TokenState } from "./shared";
import { Layer7Tab, type ZoneStatus, type AccountStatus } from "./layer7";
import { Layer3Tab } from "./layer3";
import { HelpTab } from "./help";

// ─── Page root ────────────────────────────────────────────────────────────────

export function InstallerPage() {
  const [token, setToken]           = useState("");
  const [tokenState, setTokenState] = useState<TokenState>("idle");
  const [activeTab, setActiveTab]   = useState<TabKey>("l7");
  const [csUrl, setCsUrl]                     = useState("");
  const [csKey, setCsKey]                     = useState("");
  const [workersInstalled, setWorkersInstalled] = useState<boolean | null>(null);
  const [installedLapiUrl, setInstalledLapiUrl] = useState<string | null | "loading">(null);
  const [installedAccountId, setInstalledAccountId] = useState<string | null>(null);
  const [zones, setZones]           = useState<ZoneStatus[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tokenValid = tokenState === "valid";

  async function verifyToken(val: string) {
    if (!val.trim()) { setTokenState("idle"); setWorkersInstalled(null); setInstalledLapiUrl(null); setInstalledAccountId(null); setZones([]); setZonesLoading(false); return; }
    setTokenState("checking");
    try {
      const res  = await fetch("/verify-token", { headers: { Authorization: `Bearer ${val.trim()}` } });
      const data = await res.json() as { valid?: boolean };
      if (data.valid) {
        setTokenState("valid");
        setInstalledLapiUrl("loading");
        fetch("/workers", { headers: { Authorization: `Bearer ${val.trim()}` } })
          .then((r) => r.json() as Promise<{ workers?: string[] }>)
          .then((d) => {
            const w = d.workers ?? [];
            const installed =
              w.includes("crowdsec-cloudflare-worker-bouncer") &&
              w.includes("crowdsec-decisions-sync-worker");
            setWorkersInstalled(installed);
            if (installed) {
              fetch("/worker-settings", { headers: { Authorization: `Bearer ${val.trim()}` } })
                .then((r) => r.json() as Promise<{ lapiUrl?: string | null }>)
                .then((s) => setInstalledLapiUrl(s.lapiUrl ?? null))
                .catch(() => setInstalledLapiUrl(null));
            } else {
              setInstalledLapiUrl(null);
            }
            // Fetch zone status last — slowest call
            setZonesLoading(true);
            fetch("/status", { headers: { Authorization: `Bearer ${val.trim()}` } })
              .then((r) => r.json() as Promise<{ accounts?: Array<AccountStatus> }>)
              .then((d) => {
                const accounts = d.accounts ?? [];
                setInstalledAccountId(accounts[0]?.accountId ?? null);
                setZones(accounts.flatMap((a) => a.zones));
              })
              .catch(() => setZones([]))
              .finally(() => setZonesLoading(false));
          })
          .catch(() => { setWorkersInstalled(false); setInstalledLapiUrl(null); setZonesLoading(false); });
      } else {
        setTokenState("error");
        setWorkersInstalled(null);
      }
    } catch {
      setTokenState("error");
      setWorkersInstalled(null);
    }
  }

  function refreshZones() {
    if (!token.trim()) return;
    setZonesLoading(true);
    fetch("/status", { headers: { Authorization: `Bearer ${token.trim()}` } })
      .then((r) => r.json() as Promise<{ accounts?: Array<AccountStatus> }>)
      .then((d) => {
        const accounts = d.accounts ?? [];
        setInstalledAccountId(accounts[0]?.accountId ?? null);
        setZones(accounts.flatMap((a) => a.zones));
      })
      .catch(() => setZones([]))
      .finally(() => setZonesLoading(false));
  }

  function handleWorkersChange(installed: boolean) {
    setWorkersInstalled(installed);
    if (installed) {
      setInstalledLapiUrl("loading");
      fetch("/worker-settings", { headers: { Authorization: `Bearer ${token.trim()}` } })
        .then((r) => r.json() as Promise<{ lapiUrl?: string | null }>)
        .then((s) => setInstalledLapiUrl(s.lapiUrl ?? null))
        .catch(() => setInstalledLapiUrl(null));
    } else {
      setInstalledLapiUrl(null);
      setCsUrl("");
      setCsKey("");
    }
  }

  function handleChange(val: string) {
    setToken(val);
    setTokenState("idle");
    if (debRef.current) clearTimeout(debRef.current);
    if (val.trim()) debRef.current = setTimeout(() => verifyToken(val), 600);
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#f6f7f9",
      fontFamily: "'Manrope','Inter','Segoe UI',system-ui,sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: #c2c6cc; }
        button { font-family: inherit; }
        a { text-decoration: none; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #d5d9de; border-radius: 3px; }
        ::selection { background: rgba(246,130,31,0.20); }
      `}</style>

      {/* Header */}
      <div style={{
        padding: "11px 22px", borderBottom: `1px solid ${T.border}`,
        background: T.surface, display: "flex", alignItems: "center", gap: 11,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          background: `linear-gradient(135deg,${T.orange},${T.orangeDk})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, fontSize: 13, color: "#fff",
          boxShadow: "0 1px 2px rgba(246,130,31,0.25)",
        }}>C</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
            CrowdSec
          </div>
          <div style={{ fontSize: 10, color: T.textMute, letterSpacing: "0.04em", marginTop: 1 }}>
            Cloudflare Worker Bouncer · installer
          </div>
        </div>
        <a
          href="https://doc.crowdsec.net/u/bouncers/cloudflare-workers/"
          target="_blank" rel="noreferrer"
          style={{
            fontSize: 11, color: T.textMute, fontWeight: 600,
            padding: "4px 9px", borderRadius: 4, border: `1px solid ${T.border}`,
          }}
        >
          Docs ↗
        </a>
      </div>

      {/* Accordion card */}
      <div style={{ maxWidth: 660, margin: "24px auto", padding: "0 16px" }}>
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 8, overflow: "hidden",
          boxShadow: "0 1px 3px rgba(20,24,32,0.04)",
        }}>
          <CfTokenSection
            token={token} tokenState={tokenState}
            onChange={handleChange} onBlur={() => { if (tokenState !== "valid") verifyToken(token); }}
          />
          <TabBar active={activeTab} onChange={setActiveTab} />
          {activeTab === "l7" && (
            <Layer7Tab
              csUrl={csUrl} setCsUrl={setCsUrl}
              csKey={csKey} setCsKey={setCsKey}
              workersInstalled={workersInstalled}
              installedLapiUrl={installedLapiUrl}
              installedAccountId={installedAccountId}
              zones={zones} zonesLoading={zonesLoading}
              token={token}
              onRefresh={refreshZones}
              onWorkersChange={handleWorkersChange}
            />
          )}
          {activeTab === "l3" && <Layer3Tab token={token} tokenValid={tokenValid} />}
          {activeTab === "help" && <HelpTab />}
        </div>

        <div style={{
          textAlign: "center", padding: "18px 0 32px",
          fontSize: 10.5, color: T.textFaint,
        }}>
          Token is used only in this session and never stored.
        </div>
      </div>
    </div>
  );
}
