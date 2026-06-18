import { useRef, useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ZoneStatus = {
  zoneId: string;
  domain: string;
  accountId: string;
  accountName: string;
  bound: boolean;
  kvId: string | null;
  turnstileWidgetId: string | null;
  routesToProtect: string[];
  routeIds: string[];
  actions: string[];
  defaultAction: string;
  /** null = not bound; true/false from request_limit_fail_open */
  failOpen: boolean | null;
};

type AccountStatus = {
  accountId: string;
  accountName: string;
  kvId: string | null;
  zones: ZoneStatus[];
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:        "#ffffff",
  surface:   "#ffffff",
  panel:     "#fafbfc",
  panelAlt:  "#f5f6f8",
  border:    "#e3e6ea",
  borderHi:  "#d5d9de",
  text:      "#1c1e21",
  textMid:   "#444950",
  textMute:  "#6b7280",
  textFaint: "#9aa0a8",
  textGhost: "#c2c6cc",
  orange:    "#f6821f",
  orangeDk:  "#d96a0a",
  orangeBg:  "rgba(246,130,31,0.08)",
  orangeBd:  "rgba(246,130,31,0.30)",
  green:     "#1f9d6e",
  greenBg:   "rgba(31,157,110,0.08)",
  greenBd:   "rgba(31,157,110,0.28)",
  red:       "#d63b3b",
  redBg:     "rgba(214,59,59,0.06)",
  redBd:     "rgba(214,59,59,0.28)",
  blue:      "#2563eb",
  blueBg:    "rgba(37,99,235,0.06)",
  blueBd:    "rgba(37,99,235,0.25)",
} as const;

const labelStyle: { [key: string]: string | number } = {
  fontSize: 9.5, fontWeight: 700, color: T.textMute,
  letterSpacing: "0.08em", textTransform: "uppercase",
};
const inputStyle: { [key: string]: string | number } = {
  width: "100%", padding: "8px 11px", borderRadius: 5,
  border: `1px solid ${T.border}`, background: T.surface,
  color: T.text, fontSize: 12, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ─── Shared section header button ─────────────────────────────────────────────

function SectionHeader({
  step, title, subtitle, open, enabled = true,
  status = "idle", onToggle,
}: {
  step: number;
  title: string;
  subtitle?: string;
  open: boolean;
  enabled?: boolean;
  status?: "idle" | "valid";
  onToggle?: () => void;
}) {
  const isValid = status === "valid";
  return (
    <button
      onClick={onToggle}
      disabled={!enabled}
      style={{
        width: "100%", padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 12,
        background: "transparent", border: "none",
        cursor: enabled ? "pointer" : "default", textAlign: "left",
        opacity: enabled ? 1 : 0.55,
      }}
    >
      {/* Step circle */}
      <div style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isValid ? T.greenBg : open ? T.orangeBg : T.panelAlt,
        border: `1px solid ${isValid ? T.greenBd : open ? T.orangeBd : T.border}`,
        fontSize: 10, fontWeight: 800,
        color: isValid ? T.green : open ? T.orange : T.textMute,
      }}>
        {isValid ? "✓" : step}
      </div>
      {/* Title + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: open ? T.text : T.textMid }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 1, fontFamily: "'JetBrains Mono',monospace" }}>
            {subtitle}
          </div>
        )}
      </div>
      {/* Chevron */}
      {enabled && (
        <span style={{
          color: T.textFaint, fontSize: 10, flexShrink: 0,
          transform: open ? "rotate(180deg)" : "none",
        }}>▾</span>
      )}
    </button>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 10, color = T.textMute }: { size?: number; color?: string }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: `1.5px solid ${color}30`, borderTop: `1.5px solid ${color}`,
      borderRadius: "50%", animation: "spin 0.65s linear infinite", flexShrink: 0,
    }} />
  );
}

// ─── Fail-open indicator ──────────────────────────────────────────────────────

function FailOpenIndicator({ failOpen }: { failOpen: boolean | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (failOpen === null) return null;

  const isOpen = failOpen === true;
  const color   = isOpen ? T.green : T.red;
  const bgColor = isOpen ? T.greenBg : T.redBg;
  const bdColor = isOpen ? T.greenBd : T.redBd;

  function handleEnter(e: React.MouseEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center" }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setPos(null)}
    >
      <span style={{
        width: 14, height: 14, borderRadius: "50%", cursor: "default",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: bgColor, border: `1px solid ${bdColor}`,
        fontSize: 8.5, fontWeight: 900, color, flexShrink: 0,
        lineHeight: 1,
      }}>i</span>
      {pos && (
        <div style={{
          position: "fixed", top: pos.top, left: pos.left,
          transform: "translateX(-50%)", zIndex: 9999,
          background: T.text, color: "#fff", borderRadius: 5,
          padding: "7px 10px", fontSize: 10.5, lineHeight: 1.5,
          width: 220, boxShadow: "0 4px 16px rgba(20,24,32,0.22)",
          pointerEvents: "none",
        }}>
          {/* Arrow pointing up */}
          <div style={{
            position: "absolute", top: -5, left: "50%", transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderBottom: `5px solid ${T.text}`,
          }} />
          <div style={{ fontWeight: 700, marginBottom: 3 }}>
            {isOpen ? "✓ Fail-Mode is Open (recommended)" : "✗ Fail-Mode is Closed"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.75)" }}>
            When the Worker hits its CPU limit, traffic is{" "}
            {isOpen
              ? "allowed through — your site stays up."
              : "blocked. Setting fail-open is recommended so your site stays available if the worker is rate-limited."}
          </div>
        </div>
      )}
    </span>
  );
}

// ─── Section 1 — Cloudflare API Token ────────────────────────────────────────

type TokenState = "idle" | "checking" | "valid" | "error";

function CfTokenSection({
  token, tokenState, onChange, onBlur,
}: {
  token: string;
  tokenState: TokenState;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isValid = tokenState === "valid";

  const borderColor =
    isValid              ? T.greenBd :
    tokenState === "error" ? T.redBd  : T.border;

  const statusText =
    tokenState === "idle"     && !token.trim() ? { text: "Awaiting token…",                    color: T.textFaint } :
    tokenState === "checking"                  ? null :
    isValid                                    ? { text: "✓ Token valid — permissions confirmed", color: T.green   } :
    tokenState === "error"                     ? { text: "✗ Invalid or insufficient permissions", color: T.red     } :
    null;

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <SectionHeader
        step={1} title="Cloudflare API Token"
        subtitle={!open && isValid ? `${token.slice(0, 8)}••••••••` : undefined}
        open={open} status={isValid ? "valid" : "idle"}
        onToggle={() => setOpen((o) => !o)}
      />

      <div style={{
        overflow: "hidden",
        maxHeight: open ? "300px" : "0px",
        transition: open ? "max-height 0.3s ease" : "max-height 0.2s ease",
      }}>
        <div style={{ padding: "2px 18px 16px" }}>
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={labelStyle}>API Token</label>
              <a
                href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22challenge_widgets%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22user_details%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%20%7B%22key%22%3A%20%22dns%22%2C%20%22type%22%3A%22read%22%7D%2C%20%7B%22key%22%3A%22d1%22%2C%20%22type%22%3A%22edit%22%7D%5D&name="
                target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: T.orange, textDecoration: "none", fontWeight: 600 }}
              >
                Create token ↗
              </a>
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={token}
                onChange={(e) => onChange((e.target as HTMLInputElement).value)}
                onBlur={onBlur}
                type="password"
                placeholder="Paste your Cloudflare API token…"
                style={{ ...inputStyle, borderColor, paddingRight: 34 }}
              />
              <div style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)" }}>
                {tokenState === "checking" && <Spinner />}
                {isValid                   && <span style={{ color: T.green, fontSize: 13 }}>✓</span>}
                {tokenState === "error"    && <span style={{ color: T.red,   fontSize: 13 }}>✗</span>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, minHeight: 15 }}>
            {tokenState === "checking"
              ? <span style={{ display: "flex", alignItems: "center", gap: 6, color: T.textMute }}><Spinner size={9} />Verifying…</span>
              : statusText && <span style={{ color: statusText.color }}>{statusText.text}</span>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section 2 — CrowdSec Endpoint ───────────────────────────────────────────

function CrowdSecSection({
  enabled, url, setUrl, apiKey, setApiKey, installedUrl, token, accountId,
}: {
  enabled: boolean;
  url: string;
  setUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  installedUrl: string | null | "loading";
  token: string;
  accountId: string | null;
}) {
  const [open, setOpen]         = useState(false);
  const [showKey, setShowKey]   = useState(false);
  const [editing, setEditing]   = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [updateError, setUpdateError]   = useState<string | null>(null);

  // The values as they exist on the deployed worker — used to detect changes
  const installedUrlRef = useRef<string | null>(null);

  // Auto-open when it becomes enabled for the first time
  const didAutoOpen = useRef(false);
  if (enabled && !didAutoOpen.current) {
    didAutoOpen.current = true;
    Promise.resolve().then(() => setOpen(true));
  }

  // When a real URL first arrives, pre-fill the url field and leave edit mode
  const prevInstalledUrl = useRef<string | null>(null);
  if (typeof installedUrl === "string" && installedUrl !== "loading" && installedUrl !== prevInstalledUrl.current) {
    prevInstalledUrl.current = installedUrl;
    installedUrlRef.current  = installedUrl;
    Promise.resolve().then(() => { setUrl(installedUrl); setEditing(false); });
  }

  const hostLabel     = (() => { try { return new URL(url).host; } catch { return null; } })();
  const isLoading     = installedUrl === "loading";
  const showInstalled = typeof installedUrl === "string" && installedUrl !== "loading" && !editing;

  // "Update Now" is active when editing an already-deployed config and values differ
  const isDirty = editing && installedUrlRef.current !== null && (
    url.trim() !== installedUrlRef.current || apiKey.trim() !== ""
  );

  async function handleUpdateNow() {
    if (!isDirty || !accountId) return;
    setUpdateStatus("saving");
    setUpdateError(null);
    try {
      const res = await fetch("/crowdsec-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lapiUrl: url.trim(), lapiKey: apiKey.trim(), accountId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      installedUrlRef.current = url.trim();
      setUpdateStatus("saved");
      setEditing(false);
      setTimeout(() => setUpdateStatus("idle"), 3000);
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : "Update failed");
      setUpdateStatus("error");
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <SectionHeader
        step={2} title="CrowdSec Integration Endpoint"
        subtitle={!open && hostLabel ? hostLabel : undefined}
        open={open} enabled={enabled}
        onToggle={() => setOpen((o) => !o)}
      />

      <div style={{
        overflow: "hidden",
        maxHeight: open ? "400px" : "0px",
        transition: open ? "max-height 0.3s ease" : "max-height 0.2s ease",
      }}>
        <div style={{ padding: "2px 18px 16px" }}>

          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", color: T.textMute, fontSize: 11 }}>
              <Spinner size={10} color={T.orange} />
              Checking endpoint configuration…
            </div>
          ) : showInstalled ? (
            /* ── Installed view ── */
            <div style={{
              padding: "10px 12px", borderRadius: 5,
              border: `1px solid ${T.greenBd}`, background: T.greenBg,
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 11, color: T.green, fontWeight: 700, marginBottom: 3 }}>
                  {installedUrl}
                </div>
                <div style={{ fontSize: 10.5, color: T.textMute }}>
                  {updateStatus === "saved"
                    ? "✓ Credentials updated — KV reset signalled"
                    : "Current endpoint used for protection"}
                </div>
              </div>
              <button
                onClick={() => { setEditing(true); setUpdateStatus("idle"); setUpdateError(null); }}
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
          ) : (
            /* ── Edit form ── */
            <>
              {editing && (
                <div style={{ marginBottom: 10, fontSize: 11, color: T.textMute }}>
                  Changing the URL or key and clicking <strong>Update Now</strong> will update
                  the deployed worker and reset KV decisions — the sync worker will
                  re-fetch all decisions from the new endpoint on its next run.
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelStyle, display: "block", marginBottom: 5 }}>Endpoint URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
                  placeholder="https://your-lapi.example.com"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: updateError ? 8 : 0 }}>
                <label style={{ ...labelStyle, display: "block", marginBottom: 5 }}>API Key</label>
                <div style={{ position: "relative" }}>
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                    type={showKey ? "text" : "password"}
                    placeholder={editing && installedUrlRef.current ? "Leave blank to keep existing key" : "cs_live_••••••••"}
                    style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace", paddingRight: 52 }}
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

              {updateError && (
                <div style={{ fontSize: 11, color: T.red, marginBottom: 8 }}>✗ {updateError}</div>
              )}

              {editing && installedUrlRef.current !== null && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => { setEditing(false); setUrl(installedUrlRef.current!); setApiKey(""); setUpdateError(null); }}
                    style={{
                      padding: "7px 12px", borderRadius: 5,
                      border: `1px solid ${T.border}`, background: "transparent",
                      color: T.textMute, fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateNow}
                    disabled={!isDirty || updateStatus === "saving"}
                    style={{
                      padding: "7px 14px", borderRadius: 5, border: "none",
                      background: isDirty ? T.orange : T.panelAlt,
                      color: isDirty ? "#fff" : T.textFaint,
                      fontSize: 11, fontWeight: 700,
                      cursor: isDirty && updateStatus !== "saving" ? "pointer" : "not-allowed",
                      fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                      transition: "background 0.15s",
                    }}
                  >
                    {updateStatus === "saving" && <Spinner size={9} color="#fff" />}
                    {updateStatus === "saving" ? "Updating…" : "Update Now"}
                  </button>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Section 3 — Zone Protection ─────────────────────────────────────────────

type ProgressMsg = { id: number; step: string; status: "info" | "success" | "error" };
type ConfirmModal = { op: "bind" | "unbind" | "uninstall_all"; zones: ZoneStatus[] };

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function runWs(
  msg: object,
  onProgress: (step: string, status: "info" | "success" | "error") => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(getWsUrl());
    let done = false;
    ws.onopen  = () => ws.send(JSON.stringify(msg));
    ws.onmessage = (e: MessageEvent<string>) => {
      const d = JSON.parse(e.data) as { type: string; step?: string; status?: "info" | "success" | "error"; success?: boolean; error?: string };
      if (d.type === "progress" && d.step && d.status) onProgress(d.step, d.status);
      if (d.type === "done") { done = true; ws.close(); d.success ? resolve() : reject(new Error(d.error ?? "Failed")); }
    };
    ws.onerror  = () => { if (!done) reject(new Error("WebSocket error")); };
    ws.onclose  = () => { if (!done) reject(new Error("Connection closed")); };
  });
}

type TurnstileMode = "managed" | "non-interactive" | "invisible";

function ZoneRow({ zone, selected, busy, captchaActive, onToggle, onInstall, onRemove }: {
  zone: ZoneStatus;
  selected: boolean;
  busy: boolean;
  captchaActive: boolean;
  onToggle: () => void;
  onInstall: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{
      background: selected ? T.orangeBg : T.surface,
      border: `1px solid ${selected ? T.orangeBd : T.border}`,
      borderRadius: 5, padding: "8px 12px",
      display: "flex", alignItems: "center", gap: 10,
      position: "relative", overflow: "hidden",
      opacity: busy ? 0.55 : 1, transition: "all 0.12s",
    }}>
      {zone.bound && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
          background: T.green, borderRadius: "5px 0 0 5px",
        }} />
      )}

      {/* Checkbox */}
      <div onClick={onToggle} style={{
        width: 13, height: 13, borderRadius: 2, flexShrink: 0, cursor: "pointer",
        border: `1px solid ${selected ? T.orange : T.borderHi}`,
        background: selected ? T.orange : T.surface,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.12s",
      }}>
        {selected && <span style={{ color: "#fff", fontSize: 8, fontWeight: 900 }}>✓</span>}
      </div>

      {/* Domain + badges */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "'JetBrains Mono',monospace" }}>
            {zone.domain}
          </span>
          <FailOpenIndicator failOpen={zone.failOpen} />
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            padding: "1px 6px", borderRadius: 3,
            background: zone.bound ? T.greenBg : T.panel,
            border: `1px solid ${zone.bound ? T.greenBd : T.border}`,
            color: zone.bound ? T.green : T.textMute,
            display: "inline-flex", alignItems: "center", gap: 3,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: zone.bound ? T.green : T.textFaint }} />
            {zone.bound ? "PROTECTED" : "UNPROTECTED"}
          </span>
          {captchaActive && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              padding: "1px 6px", borderRadius: 3,
              background: T.blueBg, border: `1px solid ${T.blueBd}`,
              color: T.blue, display: "inline-flex", alignItems: "center", gap: 3,
            }}>
              SUPPORTS CAPTCHA
            </span>
          )}
          <span style={{
            fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
            padding: "1px 6px", borderRadius: 3,
            background: T.panel, border: `1px solid ${T.border}`,
            color: T.textMute, display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ color: T.textFaint, fontSize: 8, fontWeight: 600 }}>zone</span>
            <span style={{ color: T.textMid }}>{zone.zoneId.slice(0, 4)}</span>
            <span style={{ color: T.textGhost, letterSpacing: "0.1em" }}>••••</span>
          </span>
        </div>
      </div>

      {/* Action */}
      <div style={{ flexShrink: 0 }}>
        {busy
          ? <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: T.textMute }}><Spinner size={9} />…</span>
          : zone.bound
            ? <button onClick={onRemove} style={{
                padding: "3px 11px", borderRadius: 4,
                border: `1px solid ${T.borderHi}`, background: T.surface,
                color: T.textMid, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>Remove</button>
            : <button onClick={onInstall} style={{
                padding: "3px 11px", borderRadius: 4,
                border: `1px solid ${T.orangeBd}`, background: T.orangeBg,
                color: T.orangeDk, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>Install</button>
        }
      </div>
    </div>
  );
}

function ProgressLog({ messages }: { messages: ProgressMsg[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  messages.length && endRef.current?.scrollIntoView({ behavior: "smooth" });
  return (
    <div style={{
      borderRadius: 5, border: `1px solid ${T.border}`, background: T.panel,
      padding: "8px 12px", marginTop: 10, maxHeight: 160, overflowY: "auto",
      fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5,
    }}>
      {messages.map((m) => (
        <div key={m.id} style={{
          display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 2,
          color: m.status === "success" ? T.green : m.status === "error" ? T.red : T.textMute,
        }}>
          <span style={{ flexShrink: 0 }}>{m.status === "success" ? "✓" : m.status === "error" ? "✗" : "›"}</span>
          <span>{m.step}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ConfirmDialog({ modal, onConfirm, onCancel }: {
  modal: ConfirmModal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDestructive = modal.op !== "bind";
  const title =
    modal.op === "bind"          ? `Enable protection on ${modal.zones.length} zone${modal.zones.length !== 1 ? "s" : ""}` :
    modal.op === "unbind"        ? `Remove protection from ${modal.zones.length} zone${modal.zones.length !== 1 ? "s" : ""}` :
    "Uninstall all CrowdSec infrastructure";
  const note =
    modal.op === "bind"          ? "Zone will be protected by CrowdSec's workers." :
    modal.op === "unbind"        ? "Zone won't be protected by CrowdSec. Workers, KV and D1 are kept." :
    "Full removal of CrowdSec Protection: Removes both workers, KV and D1. All zones lose CrowdSec protection.";
  const action = modal.op === "bind" ? "Enable" : modal.op === "unbind" ? "Remove" : "Uninstall everything";
  const color  = isDestructive ? T.red : T.orange;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(20,24,32,0.45)",
      zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, backdropFilter: "blur(2px)",
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
        padding: 22, width: "100%", maxWidth: 420,
        boxShadow: "0 18px 50px rgba(20,24,32,0.18)",
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 12 }}>{title}</div>
        {modal.op !== "uninstall_all" && modal.zones.length > 0 && (
          <div style={{
            background: T.panel, borderRadius: 5, border: `1px solid ${T.border}`,
            marginBottom: 12, maxHeight: 130, overflowY: "auto",
          }}>
            {modal.zones.map((z, i) => (
              <div key={z.zoneId} style={{
                padding: "5px 11px", fontSize: 12,
                fontFamily: "'JetBrains Mono',monospace", color: T.text,
                borderBottom: i < modal.zones.length - 1 ? `1px solid ${T.border}` : "none",
              }}>{z.domain}</div>
            ))}
          </div>
        )}
        <div style={{
          padding: "9px 12px", borderRadius: 5, marginBottom: 16,
          background: isDestructive ? T.redBg : T.orangeBg,
          border: `1px solid ${isDestructive ? T.redBd : T.orangeBd}`,
          fontSize: 11.5, color: T.textMid, lineHeight: 1.55,
        }}>{note}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "7px 14px", borderRadius: 5, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textMid,
            fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: "7px 16px", borderRadius: 5, border: "none",
            background: color, color: "#fff",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>{action}</button>
        </div>
      </div>
    </div>
  );
}

function ZonesSection({
  zones, loading, workersInstalled, token, csUrl, csKey, onRefresh, onWorkersChange,
}: {
  zones: ZoneStatus[];
  loading: boolean;
  workersInstalled: boolean | null;
  token: string;
  csUrl: string;
  csKey: string;
  onRefresh: () => void;
  onWorkersChange: (installed: boolean) => void;
}) {
  const [filter, setFilter]     = useState<"all" | "protected" | "unprotected">("all");
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyZones, setBusyZones] = useState<Set<string>>(new Set());
  const [globalBusy, setGlobalBusy] = useState(false);
  const [modal, setModal]       = useState<ConfirmModal | null>(null);
  const [progress, setProgress] = useState<ProgressMsg[]>([]);
  const [csError, setCsError]   = useState(false);
  const progressId = useRef(0);

  // zoneId → current TurnstileMode (absent = disabled)
  const [captchaMap, setCaptchaMap] = useState<Map<string, TurnstileMode>>(new Map());
  const [captchaDropdownOpen, setCaptchaDropdownOpen] = useState(false);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [failOpenBusy, setFailOpenBusy] = useState(false);

  // Initialise captchaMap from zone turnstileWidgetId on load
  useEffect(() => {
    setCaptchaMap((prev) => {
      const next = new Map(prev);
      for (const z of zones) {
        if (z.turnstileWidgetId && !next.has(z.zoneId)) next.set(z.zoneId, "managed");
        if (!z.turnstileWidgetId) next.delete(z.zoneId);
      }
      return next;
    });
  }, [zones]);

  function requestBind(targets: ZoneStatus[]) {
    if (!workersInstalled && (!csUrl.trim() || !csKey.trim())) {
      setCsError(true);
      return;
    }
    setCsError(false);
    setModal({ op: "bind", zones: targets });
  }

  const boundCount  = zones.filter((z) => z.bound).length;
  const filtered    = zones
    .filter((z) => {
      const matchFilter = filter === "all" || (filter === "protected" ? z.bound : !z.bound);
      return matchFilter && (search === "" || z.domain.toLowerCase().includes(search.toLowerCase()));
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));

  const selList = zones.filter((z) => selected.has(z.zoneId));
  const selUnbound = selList.filter((z) => !z.bound);
  const selBound   = selList.filter((z) => z.bound);
  const allFilteredSelected = filtered.length > 0 && filtered.every((z) => selected.has(z.zoneId));

  function addProgress(step: string, status: "info" | "success" | "error") {
    setProgress((prev) => [...prev, { id: progressId.current++, step, status }]);
  }

  function zoneToMsg(z: ZoneStatus) {
    return {
      zoneId: z.zoneId, domain: z.domain,
      accountId: z.accountId, accountName: z.accountName,
      actions: z.actions, defaultAction: z.defaultAction,
      routesToProtect: z.routesToProtect,
    };
  }

  async function execBind(targets: ZoneStatus[]) {
    setModal(null);
    setProgress([]);
    setBusyZones(new Set(targets.map((z) => z.zoneId)));
    try {
      if (!workersInstalled) {
        // Workers not yet installed — full install using the first zone's accountId
        const accountId = targets[0].accountId;
        await runWs({
          op: "install_workers", token, accountId,
          zones: targets.map(zoneToMsg),
          crowdsecApiUrl: csUrl, crowdsecApiKey: csKey,
        }, addProgress);
        onWorkersChange(true);
      } else {
        for (const z of targets) {
          await runWs({ op: "bind_zone", token, zone: zoneToMsg(z) }, addProgress);
        }
      }
      setSelected(new Set());
      onRefresh();
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusyZones(new Set());
    }
  }

  async function execUnbind(targets: ZoneStatus[]) {
    setModal(null);
    setProgress([]);
    setBusyZones(new Set(targets.map((z) => z.zoneId)));
    try {
      for (const z of targets) {
        await runWs({ op: "unbind_zone", token, zone: zoneToMsg(z) }, addProgress);
      }
      setSelected(new Set());
      onRefresh();
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusyZones(new Set());
    }
  }

  async function execUninstallAll() {
    setModal(null);
    setProgress([]);
    setGlobalBusy(true);
    // Group by account
    const byAccount = new Map<string, ZoneStatus[]>();
    for (const z of zones) {
      (byAccount.get(z.accountId) ?? (byAccount.set(z.accountId, []), byAccount.get(z.accountId)!)).push(z);
    }
    try {
      for (const [accountId, azones] of byAccount) {
        await runWs({ op: "uninstall_all", token, accountId, zones: azones.map(zoneToMsg) }, addProgress);
      }
      onWorkersChange(false);
      onRefresh();
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setGlobalBusy(false);
    }
  }

  function handleConfirm() {
    if (!modal) return;
    if (modal.op === "bind")         execBind(modal.zones);
    if (modal.op === "unbind")       execUnbind(modal.zones);
    if (modal.op === "uninstall_all") execUninstallAll();
  }

  function toggleZone(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    const ids = filtered.map((z) => z.zoneId);
    const allSel = ids.every((id) => selected.has(id));
    setSelected((s) => { const n = new Set(s); allSel ? ids.forEach((id) => n.delete(id)) : ids.forEach((id) => n.add(id)); return n; });
  }

  async function execFailOpen(failOpen: boolean) {
    const targets = selList.filter((z) => z.bound);
    if (targets.length === 0) return;
    setFailOpenBusy(true);
    try {
      const res = await fetch("/fail-open", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          failOpen,
          zones: targets.map((z) => ({ zoneId: z.zoneId, routesToProtect: z.routesToProtect })),
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onRefresh();
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Fail-open update failed", "error");
    } finally {
      setFailOpenBusy(false);
    }
  }

  async function execCaptcha(mode: TurnstileMode | "disabled") {
    const targets = selList.filter((z) => z.accountId === selList[0]?.accountId);
    if (targets.length === 0) return;
    setCaptchaBusy(true);
    setCaptchaDropdownOpen(false);
    try {
      const res = await fetch("/turnstile-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          accountId: targets[0].accountId,
          zones: targets.map((z) => ({ domain: z.domain, mode })),
        }),
      });
      const data = await res.json() as { ok?: boolean; failed?: string[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCaptchaMap((prev) => {
        const next = new Map(prev);
        for (const z of targets) {
          if (mode === "disabled") next.delete(z.zoneId);
          else next.set(z.zoneId, mode);
        }
        return next;
      });
      if (data.failed?.length) {
        addProgress(`Captcha: failed for ${data.failed.join(", ")}`, "error");
      }
    } catch (err: unknown) {
      addProgress(err instanceof Error ? err.message : "Captcha update failed", "error");
    } finally {
      setCaptchaBusy(false);
    }
  }

  const busy = globalBusy || busyZones.size > 0;

  return (
    <>
      <div style={{ borderBottom: `1px solid ${T.border}` }}>
        <SectionHeader step={3} title="Zone Protection" open={zones.length > 0 || loading} enabled={false} />

        <div style={{ padding: "2px 18px 16px" }}>
          {/* Workers status line */}
          {workersInstalled !== null && (
            <div style={{
              marginBottom: 10, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, color: workersInstalled ? T.green : T.textMute }}>
                <span>{workersInstalled ? "✓" : "·"}</span>
                <span>{workersInstalled
                  ? "CrowdSec remediation workers installed"
                  : "CrowdSec remediation workers will be installed along zone binding"}
                </span>
              </div>
              {workersInstalled && (
                <button
                  onClick={() => setModal({ op: "uninstall_all", zones })}
                  disabled={busy}
                  style={{
                    flexShrink: 0, padding: "3px 10px", borderRadius: 4,
                    border: `1px solid ${T.border}`, background: "transparent",
                    color: T.textMute, fontSize: 10, fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { const b = e.currentTarget; b.style.color = T.red; b.style.borderColor = T.redBd; b.style.background = T.redBg; }}
                  onMouseLeave={(e) => { const b = e.currentTarget; b.style.color = T.textMute; b.style.borderColor = T.border; b.style.background = "transparent"; }}
                >Uninstall all</button>
              )}
            </div>
          )}

          {/* CrowdSec endpoint required error */}
          {csError && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
              padding: "7px 10px", borderRadius: 5,
              background: T.redBg, border: `1px solid ${T.redBd}`,
              fontSize: 11, color: T.red, fontWeight: 600,
            }}>
              <span style={{ flexShrink: 0 }}>✗</span>
              <span style={{ flex: 1 }}>CrowdSec endpoint URL and API key are required before the first install.</span>
              <button onClick={() => setCsError(false)} style={{
                background: "none", border: "none", color: T.red, cursor: "pointer",
                fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0,
              }}>✕</button>
            </div>
          )}

          {loading || globalBusy ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: T.textMute, fontSize: 11 }}>
              <Spinner size={10} color={T.orange} />
              {globalBusy ? "Running…" : "Loading zones…"}
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {([["all", "All", zones.length], ["protected", "Protected", boundCount], ["unprotected", "Unprotected", zones.length - boundCount]] as const).map(([key, label, count]) => (
                    <button key={key} onClick={() => setFilter(key)} style={{
                      padding: "4px 10px", borderRadius: 4,
                      border: `1px solid ${filter === key ? T.orangeBd : T.border}`,
                      background: filter === key ? T.orangeBg : T.surface,
                      color: filter === key ? T.orangeDk : T.textMid,
                      fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {label}
                      <span style={{
                        fontSize: 9.5, padding: "0 4px", borderRadius: 2,
                        background: filter === key ? "rgba(246,130,31,0.16)" : T.panelAlt,
                        color: filter === key ? T.orangeDk : T.textMute, fontWeight: 700,
                      }}>{count}</span>
                    </button>
                  ))}
                </div>
                <div style={{ position: "relative", flex: 1, minWidth: 160, maxWidth: 240 }}>
                  <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: T.textFaint, fontSize: 11 }}>⌕</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                    placeholder="Filter by domain…"
                    style={{
                      width: "100%", padding: "5px 10px 5px 22px", borderRadius: 4,
                      border: `1px solid ${T.border}`, background: T.surface, color: T.text,
                      fontSize: 10.5, outline: "none", fontFamily: "'JetBrains Mono',monospace", boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Batch action bar */}
              {selected.size > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderRadius: 5, background: T.orangeBg, border: `1px solid ${T.orangeBd}`, marginBottom: 8,
                }}>
                  <span style={{ fontSize: 11, color: T.text, fontWeight: 600, flex: 1 }}>{selected.size} selected</span>
                  {selUnbound.length > 0 && (
                    <button onClick={() => requestBind(selUnbound)} style={{
                      padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.orange}`,
                      background: T.orange, color: "#fff", fontSize: 10.5, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>Install {selUnbound.length}</button>
                  )}
                  {selBound.length > 0 && (
                    <button onClick={() => setModal({ op: "unbind", zones: selBound })} style={{
                      padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.redBd}`,
                      background: T.surface, color: T.red, fontSize: 10.5, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>Remove {selBound.length}</button>
                  )}
                  {/* Fail-open batch button — only when at least one bound zone isn't already fail-open */}
                  {selBound.length > 0 && selBound.some((z) => z.failOpen !== true) && (
                    <button
                      onClick={() => execFailOpen(true)}
                      disabled={failOpenBusy}
                      style={{
                        padding: "4px 10px", borderRadius: 4,
                        border: `1px solid ${T.greenBd}`, background: T.greenBg,
                        color: T.green, fontSize: 10.5, fontWeight: 700,
                        cursor: failOpenBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                      title="Set fail-open: traffic passes through if the Worker hits its CPU limit"
                    >
                      {failOpenBusy ? <Spinner size={9} color={T.green} /> : null}
                      Set Fail-open
                    </button>
                  )}
                  {/* Captcha batch button — only for bound zones that support captcha */}
                  {(() => {
                    const captchaEligible = selList.filter((z) => z.bound && z.actions.includes("captcha"));
                    if (captchaEligible.length === 0) return null;
                    return (
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => setCaptchaDropdownOpen((o) => !o)}
                          disabled={captchaBusy}
                          style={{
                            padding: "4px 10px", borderRadius: 4,
                            border: `1px solid ${T.blueBd}`, background: T.blueBg,
                            color: T.blue, fontSize: 10.5, fontWeight: 700,
                            cursor: captchaBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                            display: "flex", alignItems: "center", gap: 4,
                          }}
                        >
                          {captchaBusy ? <Spinner size={9} color={T.blue} /> : null}
                          Set Captcha ▾
                        </button>
                        {captchaDropdownOpen && (
                          <div style={{
                            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
                            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
                            boxShadow: "0 4px 16px rgba(20,24,32,0.10)", minWidth: 160, overflow: "hidden",
                          }}>
                            {(["disabled", "managed", "non-interactive", "invisible"] as const).map((mode) => (
                              <button
                                key={mode}
                                onClick={() => execCaptcha(mode)}
                                style={{
                                  width: "100%", padding: "7px 12px", textAlign: "left",
                                  background: "none", border: "none", borderBottom: `1px solid ${T.border}`,
                                  fontSize: 11, color: mode === "disabled" ? T.red : T.textMid,
                                  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                                  display: "flex", alignItems: "center", gap: 6,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = T.panelAlt; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                              >
                                {mode === "disabled" ? "✕ Disable" :
                                 mode === "managed" ? "● Managed" :
                                 mode === "non-interactive" ? "◎ Non-interactive" : "○ Invisible"}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <button onClick={() => setSelected(new Set())} style={{
                    background: "none", border: "none", color: T.textMute, cursor: "pointer", fontSize: 12, padding: 0,
                  }}>✕</button>
                </div>
              )}

              {/* Select-all row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, paddingLeft: 2 }}>
                <div onClick={toggleAll} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <div style={{
                    width: 13, height: 13, borderRadius: 2, flexShrink: 0,
                    border: `1px solid ${allFilteredSelected ? T.orange : T.borderHi}`,
                    background: allFilteredSelected ? T.orange : T.surface,
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
                  }}>
                    {allFilteredSelected && <span style={{ color: "#fff", fontSize: 8, fontWeight: 900 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 10, color: T.textMute, fontWeight: 600 }}>Select all visible</span>
                </div>
                <span style={{ fontSize: 10, color: T.textFaint }}>{filtered.length} zone{filtered.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Zone list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {filtered.length > 0
                  ? filtered.map((zone) => (
                      <ZoneRow
                        key={zone.zoneId} zone={zone}
                        selected={selected.has(zone.zoneId)}
                        busy={busyZones.has(zone.zoneId)}
                        captchaActive={captchaMap.has(zone.zoneId)}
                        onToggle={() => toggleZone(zone.zoneId)}
                        onInstall={() => requestBind([zone])}
                        onRemove={() => setModal({ op: "unbind", zones: [zone] })}
                      />
                    ))
                  : <div style={{ textAlign: "center", padding: "20px 0", fontSize: 11, color: T.textFaint }}>
                      {zones.length === 0 ? "No zones found for this token." : "No zones match."}
                    </div>
                }
              </div>

              {/* Progress log */}
              {progress.length > 0 && <ProgressLog messages={progress} />}
            </>
          )}
        </div>
      </div>

      {modal && <ConfirmDialog modal={modal} onConfirm={handleConfirm} onCancel={() => setModal(null)} />}
    </>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export function InstallerPage() {
  const [token, setToken]           = useState("");
  const [tokenState, setTokenState] = useState<TokenState>("idle");
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
          <CrowdSecSection
            enabled={tokenValid}
            url={csUrl} setUrl={setCsUrl}
            apiKey={csKey} setApiKey={setCsKey}
            installedUrl={installedLapiUrl}
            token={token}
            accountId={installedAccountId}
          />
          <ZonesSection
            zones={zones} loading={zonesLoading}
            workersInstalled={workersInstalled}
            token={token} csUrl={csUrl} csKey={csKey}
            onRefresh={refreshZones}
            onWorkersChange={handleWorkersChange}
          />
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
