import { useRef, useState } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────

export const T = {
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

export const labelStyle: { [key: string]: string | number } = {
  fontSize: 9.5, fontWeight: 700, color: T.textMute,
  letterSpacing: "0.08em", textTransform: "uppercase",
};
export const inputStyle: { [key: string]: string | number } = {
  width: "100%", padding: "8px 11px", borderRadius: 5,
  border: `1px solid ${T.border}`, background: T.surface,
  color: T.text, fontSize: 12, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ─── Shared section header button ─────────────────────────────────────────────

export function SectionHeader({
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

export function Spinner({ size = 10, color = T.textMute }: { size?: number; color?: string }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: `1.5px solid ${color}30`, borderTop: `1.5px solid ${color}`,
      borderRadius: "50%", animation: "spin 0.65s linear infinite", flexShrink: 0,
    }} />
  );
}

// ─── Cloudflare API Token (shared between tabs) ──────────────────────────────

export type TokenState = "idle" | "checking" | "valid" | "error";

export function CfTokenSection({
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

// ─── WebSocket progress helper ───────────────────────────────────────────────

export type ProgressMsg = { id: number; step: string; status: "info" | "success" | "error" };

export function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function runWs(
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

export function ProgressLog({ messages }: { messages: ProgressMsg[] }) {
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

/**
 * Generic confirmation modal for destructive (or non-destructive) actions
 * that don't need the zone-list rendering of Layer 7's ConfirmDialog.
 */
export function SimpleConfirmDialog({ title, note, action, destructive = true, onConfirm, onCancel }: {
  title: string;
  note: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const color = destructive ? T.red : T.orange;
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
        <div style={{
          padding: "9px 12px", borderRadius: 5, marginBottom: 16,
          background: destructive ? T.redBg : T.orangeBg,
          border: `1px solid ${destructive ? T.redBd : T.orangeBd}`,
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

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export type TabKey = "l7" | "l3" | "help";

export function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "l7", label: "L7 Protection" },
    { key: "l3", label: "L3/L4 Lists" },
    { key: "help", label: "Help" },
  ];
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, background: T.panel }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1, padding: "10px 0", border: "none", background: "transparent",
              cursor: "pointer", fontFamily: "inherit",
              fontSize: 12, fontWeight: 700,
              color: isActive ? T.orange : T.textMute,
              borderBottom: `2px solid ${isActive ? T.orange : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
