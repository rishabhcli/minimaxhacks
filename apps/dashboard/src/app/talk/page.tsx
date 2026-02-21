import { VapiWidget } from "@/components/VapiWidget";

export default function TalkPage() {
  return (
    <div style={{ paddingTop: "2rem" }}>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 700, textAlign: "center", marginBottom: "1.5rem" }}>
        Talk to ShieldDesk Support
      </h2>
      <p style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
        Click the button below to start a voice conversation with our AI support agent.
        Every action is governed by our policy engine and cryptographically verified.
      </p>
      <VapiWidget />
    </div>
  );
}
