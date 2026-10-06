import { T, labelStyle } from "./shared";

function Callout({ children, tone = "orange" }: { children: React.ReactNode; tone?: "orange" | "blue" }) {
  const bg = tone === "orange" ? T.orangeBg : T.blueBg;
  const bd = tone === "orange" ? T.orangeBd : T.blueBd;
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 5,
      border: `1px solid ${bd}`, background: bg,
      fontSize: 11.5, color: T.textMid, lineHeight: 1.6, marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

function Row({ label, l7, l3 }: { label: string; l7: string; l3: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textMute }}>{label}</div>
      <div style={{ fontSize: 11.5, color: T.text }}>{l7}</div>
      <div style={{ fontSize: 11.5, color: T.text }}>{l3}</div>
    </div>
  );
}

export function HelpTab() {
  return (
    <div style={{ padding: "16px 18px 20px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 10 }}>
        Layer 7 vs Layer 3 — what's the difference?
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 10, padding: "4px 0 8px", borderBottom: `1px solid ${T.borderHi}` }}>
          <div />
          <div style={{ ...labelStyle, fontSize: 9 }}>Layer 7</div>
          <div style={{ ...labelStyle, fontSize: 9 }}>Layer 3</div>
        </div>
        <Row label="Scope" l7="Full HTTP request" l3="IP address / CIDR range only" />
        <Row label="Decisions" l7="All CrowdSec decision scopes (ip, range, as, country)" l3="Only ip and range — country/AS decisions aren't enforceable" />
        <Row label="Enforcement" l7="A Cloudflare Worker runs per-request logic on bound zones" l3="Cloudflare's network edge evaluates IP List membership, before any Worker/origin" />
        <Row label="Captcha" l7="Yes, via Turnstile" l3="No — list-based blocking only, no interactive challenge" />
        <Row label="Protects" l7="Per-zone, opt-in via Worker Routes" l3="Account-wide — whichever zone(s) you attach a firewall rule to" />
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 10 }}>
        Important: the firewall rule is manual
      </div>
      <Callout tone="orange">
        This installer provisions and fills Cloudflare IP Lists with CrowdSec decisions, but it does{" "}
        <strong>not</strong> create the firewall rule that actually blocks traffic using those lists.
        After deploying Layer 3, go to your Cloudflare dashboard → <strong>Security → WAF → Custom rules</strong>,
        and create a rule that matches against the list(s) shown in the Layer 3 tab's IP Lists section
        (action: Block, or Managed Challenge). This is a one-time manual step per zone you want protected.
      </Callout>

      <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 10 }}>
        Practical hints
      </div>
      <Callout tone="blue">
        <strong>List prefix</strong> — lets the sync worker auto-discover which of your account's IP Lists
        it's allowed to manage (any IP-kind list whose name starts with the prefix). This lets Layer 3
        coexist with other, unrelated lists you manage by hand.
      </Callout>
      <Callout tone="blue">
        <strong>Batch size</strong> — a higher batch size means more IPs are processed per sync tick, which
        means more D1 reads/writes and more Cloudflare API calls per tick. The default (10000) is a safe
        starting point; if you're on a paying Cloudflare account you can raise it (e.g. to 200000) for faster
        catch-up, but watch out for free-tier D1/API rate limits if you do.
      </Callout>
      <Callout tone="blue">
        <strong>Why no zone list on the Layer 3 tab?</strong> — the Layer 3 sync worker runs account-wide on a
        cron trigger; it has no per-zone Worker Route the way Layer 7 does. IP Lists are account-scoped
        resources, so which zone(s) end up protected depends entirely on where you attach your own firewall
        rule — outside this installer's control.
      </Callout>
    </div>
  );
}
