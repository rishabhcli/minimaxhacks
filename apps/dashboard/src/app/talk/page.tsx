"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { PolicySurface } from "@/components/PolicySurface";
import { RedTeamPanel, type AttackScenario } from "@/components/RedTeamPanel";
import { VapiWidget } from "@/components/VapiWidget";

export default function TalkPage() {
  const [redTeamMode, setRedTeamMode] = useState(false);
  const [activeScenario, setActiveScenario] = useState<AttackScenario | null>(null);

  const selectScenario = (scenario: AttackScenario | null) => {
    setActiveScenario(scenario);
  };

  const trustLevel = activeScenario?.trustLevel ?? 2;
  const sentiment = activeScenario?.sentiment ?? "neutral";

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">ShieldDesk / Voice lab</div>
          <h1 className="page-title">Test the agent boundary</h1>
          <p className="page-description">Run a real browser conversation, then inspect how trust, sentiment, confidence, and tool risk shape the decision.</p>
        </div>
        <div className="mode-switch" aria-label="Voice lab mode">
          <button className={!redTeamMode ? "active" : ""} onClick={() => { setRedTeamMode(false); setActiveScenario(null); }} type="button">
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Standard
          </button>
          <button className={redTeamMode ? "active" : ""} onClick={() => setRedTeamMode(true)} type="button">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Red team
          </button>
        </div>
      </div>

      {redTeamMode ? (
        <div className="voice-layout">
          <VapiWidget trustLevel={trustLevel} sentimentOverride={sentiment} demoContext />
          <div className="voice-side">
            <RedTeamPanel onSelectScenario={selectScenario} activeScenarioId={activeScenario?.id ?? null} />
            <PolicySurface trustLevel={trustLevel} sentiment={sentiment} compact />
          </div>
        </div>
      ) : (
        <div className="voice-layout">
          <VapiWidget />
          <div className="voice-side">
            <PolicySurface trustLevel={1} sentiment="neutral" compact />
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Guardrail status</h2>
                  <p className="panel-subtitle">What is active for every tool call</p>
                </div>
                <SlidersHorizontal size={17} color="var(--mint)" />
              </div>
              <div className="guardrail-list">
                <div className="guardrail-row"><CheckCircle2 size={15} color="var(--mint)" /><span>Risk score assigned per tool</span></div>
                <div className="guardrail-row"><CheckCircle2 size={15} color="var(--mint)" /><span>Confidence floor at 0.85 for autonomy</span></div>
                <div className="guardrail-row"><CheckCircle2 size={15} color="var(--mint)" /><span>High-risk actions route to review</span></div>
                <div className="guardrail-row"><CheckCircle2 size={15} color="var(--mint)" /><span>Failed verification fails closed</span></div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
