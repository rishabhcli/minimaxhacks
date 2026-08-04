"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import type { DashboardAction, Sentiment } from "@/lib/dashboard-data";

const TRUST_CEILINGS: Record<1 | 2 | 3 | 4, number> = {
  1: 0.1,
  2: 0.4,
  3: 0.65,
  4: 0.85,
};

const TRUST_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Anonymous",
  2: "Authenticated",
  3: "Premium",
  4: "VIP",
};

const SENTIMENT_MULTIPLIERS: Record<Sentiment, number> = {
  frustrated: 1.4,
  neutral: 1,
  satisfied: 0.9,
  calm: 0.8,
};

interface PolicySurfaceProps {
  trustLevel: 1 | 2 | 3 | 4;
  sentiment: Sentiment;
  actions?: DashboardAction[];
  compact?: boolean;
}

export function PolicySurface({ trustLevel, sentiment, actions = [], compact = false }: PolicySurfaceProps) {
  const ceiling = TRUST_CEILINGS[trustLevel];
  const multiplier = SENTIMENT_MULTIPLIERS[sentiment];
  const threshold = ceiling * multiplier;

  return (
    <section className="panel" id="policy">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Policy posture</h2>
          <p className="panel-subtitle">The boundary applied to the current session</p>
        </div>
        <ShieldCheck size={17} color="var(--mint)" />
      </div>
      <div className="policy-card">
        <div className="policy-equation" aria-label="Effective threshold equals trust ceiling times sentiment multiplier">
          <span>threshold</span>
          <span>=</span>
          <span className="equation-value">{ceiling.toFixed(2)}</span>
          <span>×</span>
          <span className="equation-value">{multiplier.toFixed(2)}</span>
          <span>=</span>
          <strong className="equation-value">{threshold.toFixed(3)}</strong>
        </div>

        <div className="policy-meters">
          <div className="meter-row">
            <div className="meter-label-row">
              <span>Trust ceiling · {TRUST_LABELS[trustLevel]}</span>
              <strong>{ceiling.toFixed(2)}</strong>
            </div>
            <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, ceiling * 100)}%` }} /></div>
          </div>
          <div className="meter-row">
            <div className="meter-label-row">
              <span>Sentiment · {sentiment}</span>
              <strong>{multiplier.toFixed(2)}×</strong>
            </div>
            <div className="meter-track"><div className="meter-fill warning" style={{ width: `${Math.min(100, (multiplier / 1.4) * 100)}%` }} /></div>
          </div>
          <div className="meter-row">
            <div className="meter-label-row">
              <span>Effective threshold</span>
              <strong>{threshold.toFixed(3)}</strong>
            </div>
            <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, threshold * 100)}%` }} /></div>
          </div>
        </div>

        {!compact && actions.length > 0 && (
          <div className="policy-footnote">
            <LockKeyhole size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            <strong>{actions.length} recent tool decision{actions.length === 1 ? "" : "s"}</strong> evaluated against this session boundary.
          </div>
        )}
        {compact && (
          <div className="policy-footnote">
            <LockKeyhole size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            High-risk actions never bypass policy review.
          </div>
        )}
      </div>
    </section>
  );
}
