"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/api";

interface GovernanceAction {
  _id: string;
  toolName: string;
  policyDecision?: "allow" | "deny" | "escalate";
  policyReason?: string;
  riskScore?: number;
  effectiveThreshold?: number;
  confidence?: number;
  sentimentAtTime?: string;
  armoriqVerified?: boolean;
  ts: number;
}

const DECISION_STYLES: Record<string, { badge: string; icon: string }> = {
  allow: { badge: "badge-allow", icon: "ALLOW" },
  deny: { badge: "badge-deny", icon: "DENY" },
  escalate: { badge: "badge-escalate", icon: "ESCALATE" },
};

export function GovernanceLog() {
  const actions = useQuery(api.agentActions.recent, { limit: 20 }) as GovernanceAction[] | undefined;

  return (
    <div className="card" style={{ height: "100%" }}>
      <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
        Governance Log
      </h4>

      {!actions || actions.length === 0 ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          No governance decisions yet. Start a call and interact with the agent.
        </p>
      ) : (
        <div style={{ maxHeight: "350px", overflow: "auto" }}>
          {actions.map((action) => {
            const decision = action.policyDecision ?? "escalate";
            const style = DECISION_STYLES[decision] ?? DECISION_STYLES.escalate;
            return (
              <div key={action._id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <code style={{ fontSize: "0.8rem", color: "var(--accent)" }}>
                    {action.toolName}
                  </code>
                  <span className={`badge ${style.badge}`}>
                    {style.icon}
                  </span>
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  risk:{action.riskScore?.toFixed(2) ?? "?"}
                  {action.effectiveThreshold != null && (
                    <> | thresh:{action.effectiveThreshold.toFixed(2)}</>
                  )}
                  {action.confidence != null && (
                    <> | conf:{action.confidence.toFixed(2)}</>
                  )}
                  {action.sentimentAtTime && (
                    <> | {action.sentimentAtTime}</>
                  )}
                  {action.armoriqVerified && (
                    <> | verified</>
                  )}
                </div>
                {action.policyReason && (
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic", marginTop: "0.125rem" }}>
                    {action.policyReason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
