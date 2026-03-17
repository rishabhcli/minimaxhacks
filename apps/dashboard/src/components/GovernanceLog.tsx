"use client";

export function GovernanceLog() {
  return (
    <div className="card" style={{ height: "100%" }}>
      <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
        Governance Log
      </h4>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Governance log requires an authenticated, conversation-scoped view.
      </p>
    </div>
  );
}
