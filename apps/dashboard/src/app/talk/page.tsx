"use client";

import { useState } from "react";
import { VapiWidget } from "@/components/VapiWidget";
import { RedTeamPanel, type AttackScenario } from "@/components/RedTeamPanel";

export default function TalkPage() {
  const [redTeamMode, setRedTeamMode] = useState(false);
  const [activeScenario, setActiveScenario] = useState<AttackScenario | null>(null);

  const handleSelectScenario = (scenario: AttackScenario | null) => {
    setActiveScenario(scenario);
  };

  const trustLevel = activeScenario?.trustLevel ?? 2;
  const sentimentOverride = activeScenario?.sentiment;

  return (
    <div style={{ paddingTop: "2rem" }}>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 700, textAlign: "center", marginBottom: "1rem" }}>
        Talk to ShieldDesk Support
      </h2>

      {/* Mode toggle */}
      <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginBottom: "2rem" }}>
        <button
          onClick={() => { setRedTeamMode(false); setActiveScenario(null); }}
          className={`btn ${!redTeamMode ? "btn-primary" : "btn-outline"}`}
          style={{ fontSize: "0.8rem" }}
        >
          Normal Mode
        </button>
        <button
          onClick={() => setRedTeamMode(true)}
          className={`btn ${redTeamMode ? "" : "btn-outline"}`}
          style={redTeamMode ? { fontSize: "0.8rem", background: "var(--red)", color: "white" } : { fontSize: "0.8rem" }}
        >
          Red Team Mode
        </button>
      </div>

      {!redTeamMode ? (
        /* Normal mode — just the widget centered */
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>
          <p style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: "2rem", fontSize: "0.875rem" }}>
            Click the button below to start a voice conversation with our AI support agent.
            Every action is governed by our policy engine and cryptographically verified.
          </p>
          <VapiWidget />
        </div>
      ) : (
        /* Red Team mode — three-column layout */
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1rem", alignItems: "start" }}>
          {/* Left: Attack scenarios */}
          <div className="card" style={{ padding: "1rem" }}>
            <RedTeamPanel
              onSelectScenario={handleSelectScenario}
              activeScenarioId={activeScenario?.id ?? null}
            />
          </div>

          {/* Right: Voice widget */}
          <div>
            <VapiWidget
              trustLevel={trustLevel as 1 | 2 | 3 | 4}
              sentimentOverride={sentimentOverride}
            />
          </div>
        </div>
      )}
    </div>
  );
}
