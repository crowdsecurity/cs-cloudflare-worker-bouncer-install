import { useEffect, useRef, useState } from "react";
import {
  T, labelStyle, inputStyle,
  SectionHeader, Spinner, ProgressLog, SimpleConfirmDialog,
  runWs,
  type ProgressMsg,
} from "./shared";

// ─── Types mirroring workers/services/cloudflare/l3-status.ts ──────────────

type IpListInfo = { id: string; name: string; numItems: number };

type L3AccountStatus = {
  accountId: string;
  accountName: string;
  workerDeployed: boolean;
  kvNamespaceId: string | null;
  d1DatabaseId: string | null;
  d1TableExists: boolean | null;
  lapiUrl: string | null;
  ipListPrefix: string;
  ipListBatchSize: number;
  matchingLists: IpListInfo[];
  allLists: IpListInfo[];
};

type ConsistencyCheckResult = {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
};

const DEFAULT_PREFIX = "crowdsec_";
const DEFAULT_BATCH_SIZE = 10000;

// ─── L3 Sync Worker section ──────────────────────────────────────────────────

/**
 * Suggest the next sequential suffix (00, 01, 02, ...) for a given prefix,
 * based on existing list names that already follow that pattern.
 */
function suggestNextListSuffix(allLists: IpListInfo[], prefix: string): string {
  const used = new Set<number>();
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{2,})$`);
  for (const l of allLists) {
    const m = re.exec(l.name);
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 0;
  while (used.has(n)) n++;
  return String(n).padStart(2, "0");
}

function InfoTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  function handleEnter(e: React.MouseEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }} onMouseEnter={handleEnter} onMouseLeave={() => setPos(null)}>
      <span style={{
        width: 13, height: 13, borderRadius: "50%", cursor: "default",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: T.blueBg, border: `1px solid ${T.blueBd}`,
        fontSize: 8, fontWeight: 900, color: T.blue, flexShrink: 0, lineHeight: 1,
      }}>i</span>
      {pos && (
        <div style={{
          position: "fixed", top: pos.top, left: pos.left,
          transform: "translateX(-50%)", zIndex: 9999,
          background: T.text, color: "#fff", borderRadius: 5,
          padding: "7px 10px", fontSize: 10.5, lineHeight: 1.5,
          width: 230, boxShadow: "0 4px 16px rgba(20,24,32,0.22)",
          pointerEvents: "none",
        }}>{text}</div>
      )}
    </span>
  );
}

function L3WorkerSection({
  status, loading, token, accountId, onRefresh,
}: {
  status: L3AccountStatus | null;
  loading: boolean;
  token: string;
  accountId: string | null;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [lapiUrl, setLapiUrl] = useState("");
  const [lapiKey, setLapiKey] = useState("");
  const [ipListPrefix, setIpListPrefix] = useState(DEFAULT_PREFIX);
  const [ipListBatchSize, setIpListBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showUninstallDonePopin, setShowUninstallDonePopin] = useState(false);
  const [progress, setProgress] = useState<ProgressMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const progressId = useRef(0);

  const didAutoOpen = useRef(false);
  if (!loading && !didAutoOpen.current) {
    didAutoOpen.current = true;
    Promise.resolve().then(() => setOpen(true));
  }

  // Pre-fill the form from the installed worker's settings once known
  const prevDeployed = useRef<boolean | null>(null);
  if (status && status.workerDeployed && prevDeployed.current !== true) {
    prevDeployed.current = true;
    Promise.resolve().then(() => {
      setLapiUrl(status.lapiUrl ?? "");
      setIpListPrefix(status.ipListPrefix);
      setIpListBatchSize(status.ipListBatchSize);
      setEditing(false);
    });
  }

  function addProgress(step: string, s: "info" | "success" | "error") {
    setProgress((prev) => [...prev, { id: progressId.current++, step, status: s }]);
  }

  const isDeployed = status?.workerDeployed ?? false;
  const showInstalled = isDeployed && !editing;

  // Per-field dirty flags — drive both the border highlight and the partial
  // update payload (only changed fields are sent; see handleSaveSettings).
  const urlDirty    = editing && isDeployed && lapiUrl.trim() !== (status?.lapiUrl ?? "");
  const keyDirty    = editing && isDeployed && lapiKey.trim() !== "";
  const prefixDirty = editing && isDeployed && ipListPrefix.trim() !== status?.ipListPrefix;
  const batchDirty  = editing && isDeployed && ipListBatchSize !== status?.ipListBatchSize;
  const isDirty = urlDirty || keyDirty || prefixDirty || batchDirty;

  async function handleInstall() {
    if (!accountId || !lapiUrl.trim() || !lapiKey.trim()) return;
    setProgress([]);
    setBusy(true);
    try {
      await runWs({
        op: "install_l3_worker", token, accountId,
        crowdsecApiUrl: lapiUrl.trim(), crowdsecApiKey: lapiKey.trim(),
        ipListPrefix: ipListPrefix.trim() || DEFAULT_PREFIX,
        ipListBatchSize: ipListBatchSize || DEFAULT_BATCH_SIZE,
      }, addProgress);
      onRefresh();
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Install failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    if (!isDirty || !accountId) return;
    if (urlDirty) {
      try { new URL(lapiUrl.trim()); } catch {
        setSaveError("Invalid URL — expected format: https://your-lapi.example.com");
        return;
      }
    }
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch("/l3-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          accountId,
          ...(urlDirty    && { lapiUrl: lapiUrl.trim() }),
          ...(keyDirty    && { lapiKey: lapiKey.trim() }),
          ...(prefixDirty && { ipListPrefix: ipListPrefix.trim() }),
          ...(batchDirty  && { ipListBatchSize }),
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaveStatus("saved");
      setEditing(false);
      onRefresh();
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Update failed");
      setSaveStatus("error");
    }
  }

  async function handleUninstall() {
    setShowUninstallConfirm(false);
    if (!accountId) return;
    setProgress([]);
    setBusy(true);
    try {
      await runWs({ op: "uninstall_l3_worker", token, accountId }, addProgress);
      onRefresh();
      setShowUninstallDonePopin(true);
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Uninstall failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <SectionHeader
        step={1} title="L3 Sync Worker"
        subtitle={!open && isDeployed ? "crowdsec-decisions-l3-sync-worker" : undefined}
        open={open} onToggle={() => setOpen((o) => !o)}
      />

      <div style={{
        overflow: "hidden",
        maxHeight: open ? "560px" : "0px",
        transition: open ? "max-height 0.3s ease" : "max-height 0.2s ease",
      }}>
        <div style={{ padding: "2px 18px 16px" }}>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", color: T.textMute, fontSize: 11 }}>
              <Spinner size={10} color={T.orange} />
              Checking L3 deployment status…
            </div>
          ) : showInstalled ? (
            <>
              <div style={{
                padding: "10px 12px", borderRadius: 5,
                border: `1px solid ${T.greenBd}`, background: T.greenBg,
                display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
                marginBottom: 10,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: T.green, fontWeight: 700, marginBottom: 3 }}>
                    {status?.lapiUrl}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.textMute }}>
                    prefix <code>{status?.ipListPrefix}</code> · batch size {status?.ipListBatchSize.toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => { setEditing(true); setSaveStatus("idle"); setSaveError(null); }}
                  style={{
                    flexShrink: 0, padding: "4px 11px", borderRadius: 4,
                    border: `1px solid ${T.border}`, background: T.surface,
                    color: T.textMid, fontSize: 10.5, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Edit
                </button>
              </div>
              <button
                onClick={() => setShowUninstallConfirm(true)}
                disabled={busy}
                style={{
                  padding: "5px 11px", borderRadius: 4,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.textMute, fontSize: 10.5, fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { const b = e.currentTarget; b.style.color = T.red; b.style.borderColor = T.redBd; b.style.background = T.redBg; }}
                onMouseLeave={(e) => { const b = e.currentTarget; b.style.color = T.textMute; b.style.borderColor = T.border; b.style.background = "transparent"; }}
              >
                Uninstall L3 Worker
              </button>
            </>
          ) : (
            <>
              {!isDeployed && (
                <div style={{ marginBottom: 10, fontSize: 11, color: T.textMute, lineHeight: 1.5 }}>
                  Deploys an independent sync worker (<code>crowdsec-decisions-l3-sync-worker</code>) that
                  fills Cloudflare IP Lists with CrowdSec decisions, using a dedicated KV namespace and D1
                  database. Runs account-wide — no per-zone binding needed.
                </div>
              )}
              {editing && (
                <div style={{ marginBottom: 10, fontSize: 11, color: T.textMute }}>
                  Changing these values and clicking <strong>Save</strong> will update the deployed worker
                  and reset its sync state.
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelStyle, display: "block", marginBottom: 5 }}>Endpoint URL</label>
                <input
                  value={lapiUrl}
                  onChange={(e) => setLapiUrl((e.target as HTMLInputElement).value)}
                  placeholder="https://your-lapi.example.com"
                  style={{ ...inputStyle, borderColor: urlDirty ? T.orangeBd : T.border }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelStyle, display: "block", marginBottom: 5 }}>API Key</label>
                <div style={{ position: "relative" }}>
                  <input
                    value={lapiKey}
                    onChange={(e) => setLapiKey((e.target as HTMLInputElement).value)}
                    type={showKey ? "text" : "password"}
                    placeholder={isDeployed ? "Leave blank to keep existing key" : "cs_live_••••••••"}
                    style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace", paddingRight: 52, borderColor: keyDirty ? T.orangeBd : T.border }}
                  />
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    style={{
                      position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: T.textFaint,
                      cursor: "pointer", fontSize: 9, letterSpacing: "0.06em",
                      fontFamily: "inherit", fontWeight: 700, padding: 0,
                    }}
                  >
                    {showKey ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, display: "block", marginBottom: 5 }}>IP List Prefix</label>
                  <input
                    value={ipListPrefix}
                    onChange={(e) => setIpListPrefix((e.target as HTMLInputElement).value)}
                    placeholder={DEFAULT_PREFIX}
                    style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace", borderColor: prefixDirty ? T.orangeBd : T.border }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                    IPs per Sync Tick
                    <InfoTooltip text="How many IPs the worker processes per sync tick. On Cloudflare's free tier, an IP List is capped at 10,000 items — one list is enough at the default. Raise this only on a paying account, where more/larger lists are usable." />
                  </label>
                  <input
                    type="number"
                    value={ipListBatchSize}
                    onChange={(e) => setIpListBatchSize(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                    style={{ ...inputStyle, borderColor: batchDirty ? T.orangeBd : T.border }}
                  />
                </div>
              </div>

              {/* Live preview of lists matching the prefix being typed, with sequential-suffix autocomplete */}
              {(() => {
                const allLists = status?.allLists ?? [];
                const typedPrefix = ipListPrefix.trim() || DEFAULT_PREFIX;
                const liveMatches = allLists.filter((l) => l.name.startsWith(typedPrefix));
                const suggestedSuffix = suggestNextListSuffix(allLists, typedPrefix);
                return (
                  <div style={{ marginBottom: 12, fontSize: 10.5, color: T.textMute }}>
                    {liveMatches.length > 0 ? (
                      <div style={{
                        background: T.panel, borderRadius: 5, border: `1px solid ${T.border}`,
                        padding: "6px 9px", marginBottom: 4,
                      }}>
                        {liveMatches.map((l) => (
                          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace" }}>
                            <span style={{ color: T.text }}>{l.name}</span>
                            <span style={{ color: T.textFaint }}>{l.numItems.toLocaleString()} items</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 4 }}>No existing list matches this prefix yet.</div>
                    )}
                    <div>
                      Next sequential name available: <code>{typedPrefix}{suggestedSuffix}</code>
                    </div>
                  </div>
                );
              })()}

              {saveError && (
                <div style={{ fontSize: 11, color: T.red, marginBottom: 8 }}>✗ {saveError}</div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                {editing && (
                  <button
                    onClick={() => { setEditing(false); setLapiKey(""); setSaveError(null); }}
                    style={{
                      padding: "7px 12px", borderRadius: 5,
                      border: `1px solid ${T.border}`, background: "transparent",
                      color: T.textMute, fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={editing ? handleSaveSettings : handleInstall}
                  disabled={busy || (editing ? !isDirty || saveStatus === "saving" : !lapiUrl.trim() || !lapiKey.trim())}
                  style={{
                    padding: "7px 14px", borderRadius: 5, border: "none",
                    background: T.orange, color: "#fff",
                    fontSize: 11, fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: (editing ? !isDirty : !lapiUrl.trim() || !lapiKey.trim()) ? 0.5 : 1,
                    fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {(busy || saveStatus === "saving") && <Spinner size={9} color="#fff" />}
                  {editing ? (saveStatus === "saving" ? "Saving…" : "Save") : (busy ? "Installing…" : "Install L3 Worker")}
                </button>
              </div>
            </>
          )}

          {progress.length > 0 && <ProgressLog messages={progress} />}
        </div>
      </div>

      {showUninstallConfirm && (
        <SimpleConfirmDialog
          title="Uninstall L3 Worker"
          note="Removes the L3 sync worker, its dedicated KV namespace and its D1 database. Any Cloudflare IP Lists matching your prefix are left exactly as they are — it's up to you to decide what to do with them (keep, reuse, or delete manually)."
          action="Uninstall"
          onConfirm={handleUninstall}
          onCancel={() => setShowUninstallConfirm(false)}
        />
      )}

      {showUninstallDonePopin && (
        <SimpleConfirmDialog
          title="L3 Worker uninstalled"
          note="The L3 worker, its KV namespace and D1 database were removed. Any IP Lists matching your prefix were left untouched — it's up to you to decide what to do with them (keep, reuse, or delete manually)."
          action="OK"
          destructive={false}
          onConfirm={() => setShowUninstallDonePopin(false)}
          onCancel={() => setShowUninstallDonePopin(false)}
        />
      )}
    </div>
  );
}

// ─── IP Lists & D1 section ───────────────────────────────────────────────────

function IpListsAndD1Section({
  status, loading, token, accountId, onRefresh,
}: {
  status: L3AccountStatus | null;
  loading: boolean;
  token: string;
  accountId: string | null;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingD1, setActivatingD1] = useState(false);
  const [d1Error, setD1Error] = useState<string | null>(null);
  const [showAllLists, setShowAllLists] = useState(false);
  const [newListSuffix, setNewListSuffix] = useState("default");
  const [creatingList, setCreatingList] = useState(false);
  const [createListError, setCreateListError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<ConsistencyCheckResult | null>(null);
  const [runningCheck, setRunningCheck] = useState(false);

  const prefix = status?.ipListPrefix ?? DEFAULT_PREFIX;

  async function handleRefresh() {
    setRefreshing(true);
    try { onRefresh(); } finally { setRefreshing(false); }
  }

  async function handleActivateD1() {
    if (!accountId) return;
    setActivatingD1(true);
    setD1Error(null);
    try {
      const res = await fetch("/l3-activate-d1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onRefresh();
    } catch (err: unknown) {
      setD1Error(err instanceof Error ? err.message : "Failed to activate D1");
    } finally {
      setActivatingD1(false);
    }
  }

  async function handleCreateList() {
    if (!accountId || !newListSuffix.trim()) return;
    const name = `${prefix}${newListSuffix.trim()}`;
    if (!/^[a-z0-9_]+$/.test(name)) {
      setCreateListError("List name must contain only lowercase letters, digits and underscores");
      return;
    }
    setCreatingList(true);
    setCreateListError(null);
    try {
      const res = await fetch("/l3-ip-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accountId, name }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onRefresh();
    } catch (err: unknown) {
      setCreateListError(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setCreatingList(false);
    }
  }

  async function handleRunCheck() {
    if (!accountId) return;
    setRunningCheck(true);
    setCheckResult(null);
    try {
      const res = await fetch(`/l3-consistency-check?accountId=${encodeURIComponent(accountId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as ConsistencyCheckResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCheckResult(data);
    } catch (err: unknown) {
      setCheckResult({ ok: false, checks: [{ name: "Consistency check", pass: false, detail: err instanceof Error ? err.message : "Failed" }] });
    } finally {
      setRunningCheck(false);
    }
  }

  const d1Active = status?.d1DatabaseId !== null && status?.d1TableExists === true;
  const allLists = status?.allLists ?? [];
  const matchingLists = status?.matchingLists ?? [];

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <SectionHeader step={2} title="IP Lists & D1" open={open} onToggle={() => setOpen((o) => !o)} />

      <div style={{
        overflow: "hidden",
        maxHeight: open ? "900px" : "0px",
        transition: open ? "max-height 0.3s ease" : "max-height 0.2s ease",
      }}>
        <div style={{ padding: "2px 18px 18px" }}>

          {/* Firewall-rule gap callout */}
          <div style={{
            padding: "9px 12px", borderRadius: 5, marginBottom: 14,
            background: T.orangeBg, border: `1px solid ${T.orangeBd}`,
            fontSize: 11, color: T.textMid, lineHeight: 1.55,
          }}>
            CrowdSec fills these lists automatically. You still need to create a firewall rule in your
            Cloudflare dashboard (Security → WAF → Custom rules) that blocks traffic matching them —
            this installer does not do that part. See the Help tab for details.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || !accountId}
              style={{
                padding: "4px 10px", borderRadius: 4,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.textMute, fontSize: 10, fontWeight: 700,
                cursor: refreshing ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              {refreshing && <Spinner size={9} />}
              Refresh
            </button>
          </div>

          {/* D1 status */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, display: "block", marginBottom: 6 }}>D1 Database</label>
            {loading ? (
              <Spinner size={10} color={T.orange} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: d1Active ? T.green : T.textMute,
                }}>
                  {d1Active ? "✓ Active" : "Not yet activated"}
                </span>
                {!d1Active && (
                  <button
                    onClick={handleActivateD1}
                    disabled={activatingD1 || !accountId}
                    style={{
                      padding: "4px 11px", borderRadius: 4,
                      border: `1px solid ${T.orangeBd}`, background: T.orangeBg,
                      color: T.orangeDk, fontSize: 10.5, fontWeight: 700,
                      cursor: activatingD1 ? "not-allowed" : "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    {activatingD1 && <Spinner size={9} color={T.orangeDk} />}
                    {activatingD1 ? "Activating…" : "Activate D1"}
                  </button>
                )}
              </div>
            )}
            {d1Error && <div style={{ fontSize: 11, color: T.red, marginTop: 6 }}>✗ {d1Error}</div>}
          </div>

          {/* IP Lists */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              IP Lists matching prefix <code>{prefix}</code>
              <span
                onClick={() => setShowAllLists((v) => !v)}
                title="Show all IP Lists on this account"
                style={{
                  cursor: "pointer", fontSize: 11, color: T.textMute,
                  display: "inline-flex", alignItems: "center", gap: 2,
                }}
              >
                🔍 {allLists.length}
              </span>
            </label>

            {loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", color: T.textMute, fontSize: 11 }}>
                <Spinner size={10} color={T.orange} />
                Checking…
              </div>
            ) : (
              <>
                {showAllLists && (
                  <div style={{
                    background: T.panel, borderRadius: 5, border: `1px solid ${T.border}`,
                    marginBottom: 8,
                  }}>
                    <div style={{ padding: "6px 11px", fontSize: 10, color: T.textFaint, borderBottom: `1px solid ${T.border}` }}>
                      All IP Lists on this account ({allLists.length})
                    </div>
                    {allLists.length === 0 ? (
                      <div style={{ padding: "6px 11px", fontSize: 11, color: T.textFaint }}>No IP Lists exist yet.</div>
                    ) : allLists.map((l, i) => (
                      <div key={l.id} style={{
                        padding: "6px 11px", fontSize: 11.5, display: "flex", justifyContent: "space-between",
                        fontFamily: "'JetBrains Mono',monospace",
                        color: l.name.startsWith(prefix) ? T.text : T.textFaint,
                        borderBottom: i < allLists.length - 1 ? `1px solid ${T.border}` : "none",
                      }}>
                        <span>{l.name}</span>
                        <span style={{ color: T.textFaint }}>{l.numItems.toLocaleString()} items</span>
                      </div>
                    ))}
                  </div>
                )}

                {matchingLists.length === 0 ? (
                  <div style={{
                    padding: "9px 12px", borderRadius: 5, marginBottom: 8,
                    background: T.orangeBg, border: `1px solid ${T.orangeBd}`,
                    fontSize: 11, color: T.textMid,
                  }}>
                    <div style={{ marginBottom: 8 }}>No list found matching prefix <code>{prefix}</code>.</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: T.textMute }}>{prefix}</span>
                      <input
                        value={newListSuffix}
                        onChange={(e) => setNewListSuffix((e.target as HTMLInputElement).value)}
                        style={{ ...inputStyle, width: 120, padding: "5px 8px" }}
                      />
                      <button
                        onClick={handleCreateList}
                        disabled={creatingList || !newListSuffix.trim()}
                        style={{
                          padding: "5px 11px", borderRadius: 4, border: "none",
                          background: T.orange, color: "#fff",
                          fontSize: 10.5, fontWeight: 700,
                          cursor: creatingList ? "not-allowed" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        {creatingList && <Spinner size={9} color="#fff" />}
                        Create
                      </button>
                    </div>
                    {createListError && <div style={{ fontSize: 11, color: T.red, marginTop: 6 }}>✗ {createListError}</div>}
                  </div>
                ) : (
                  <div style={{
                    background: T.panel, borderRadius: 5, border: `1px solid ${T.border}`,
                  }}>
                    {matchingLists.map((l, i) => (
                      <div key={l.id} style={{
                        padding: "6px 11px", fontSize: 11.5, display: "flex", justifyContent: "space-between",
                        fontFamily: "'JetBrains Mono',monospace", color: T.text,
                        borderBottom: i < matchingLists.length - 1 ? `1px solid ${T.border}` : "none",
                      }}>
                        <span>{l.name}</span>
                        <span style={{ color: T.textFaint }}>{l.numItems.toLocaleString()} items</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Consistency check */}
          <div>
            <button
              onClick={handleRunCheck}
              disabled={runningCheck || !accountId}
              style={{
                padding: "6px 12px", borderRadius: 5,
                border: `1px solid ${T.border}`, background: T.surface,
                color: T.textMid, fontSize: 11, fontWeight: 700,
                cursor: runningCheck ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
              }}
            >
              {runningCheck && <Spinner size={9} />}
              {runningCheck ? "Running…" : "Run consistency check"}
            </button>

            {checkResult && (
              <div style={{
                borderRadius: 5, border: `1px solid ${T.border}`, background: T.panel,
                padding: "8px 12px", fontSize: 11,
              }}>
                {checkResult.checks.map((ch, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4,
                    color: ch.pass ? T.green : T.red,
                  }}>
                    <span style={{ flexShrink: 0 }}>{ch.pass ? "✓" : "✗"}</span>
                    <span>
                      <span style={{ color: T.text }}>{ch.name}</span>
                      {ch.detail && <span style={{ color: T.textMute }}> — {ch.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Layer 3 tab root ─────────────────────────────────────────────────────────

export function Layer3Tab({ token, tokenValid }: { token: string; tokenValid: boolean }) {
  const [status, setStatus] = useState<L3AccountStatus | null>(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    if (!token.trim()) return;
    setLoading(true);
    fetch("/l3-status", { headers: { Authorization: `Bearer ${token.trim()}` } })
      .then((r) => r.json() as Promise<{ accounts?: L3AccountStatus[] }>)
      .then((d) => setStatus(d.accounts?.[0] ?? null))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (tokenValid) refresh();
    else setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenValid, token]);

  return (
    <>
      <L3WorkerSection
        status={status} loading={loading} token={token}
        accountId={status?.accountId ?? null} onRefresh={refresh}
      />
      <IpListsAndD1Section
        status={status} loading={loading} token={token}
        accountId={status?.accountId ?? null} onRefresh={refresh}
      />
    </>
  );
}
