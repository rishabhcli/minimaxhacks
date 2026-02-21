"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/api";
import { useParams } from "next/navigation";

// Types for Convex documents (anyApi returns untyped results)
interface Transcript {
  _id: string;
  speaker: string;
  text: string;
  isFinal: boolean;
  ts: number;
}

interface AgentAction {
  _id: string;
  toolName: string;
  policyDecision?: string;
  policyReason?: string;
  confidence?: number;
  riskScore?: number;
  effectiveThreshold?: number;
  armoriqVerified?: boolean;
  status: string;
  ts: number;
}

interface ConversationEvent {
  _id: string;
  kind: string;
  actorKind: string;
  payload: unknown;
  ts: number;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const conversation = useQuery(api.conversations.getById, { id });
  const transcripts = useQuery(api.transcripts.byConversation, { conversationId: id }) as Transcript[] | undefined;
  const actions = useQuery(api.agentActions.byConversation, { conversationId: id }) as AgentAction[] | undefined;
  const events = useQuery(api.conversationEvents.byConversation, { conversationId: id }) as ConversationEvent[] | undefined;

  if (conversation === undefined) {
    return <p style={{ color: "var(--text-muted)" }}>Loading...</p>;
  }

  if (conversation === null) {
    return <p style={{ color: "var(--red)" }}>Conversation not found.</p>;
  }

  return (
    <div>
      <a href="/" style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem", display: "inline-block" }}>
        &larr; Back to conversations
      </a>

      {/* Panel 1: Conversation Card */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Conversation
            </h2>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className={`badge ${conversation.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
                {conversation.channelType === "vapi_web" ? "Web (VAPI)" : "Phone (Plivo)"}
              </span>
              <span className={`badge ${conversation.status === "active" ? "badge-active" : "badge-completed"}`}>
                {conversation.status}
              </span>
              <span className="badge" style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent)" }}>
                Trust Level {conversation.trustLevel}
              </span>
              {conversation.sentimentScore && (
                <span className="badge" style={{ background: "rgba(234,179,8,0.1)", color: "var(--yellow)" }}>
                  {conversation.sentimentScore}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <div>Started: {new Date(conversation.startedAt).toLocaleString()}</div>
            {conversation.endedAt && (
              <div>Ended: {new Date(conversation.endedAt).toLocaleString()}</div>
            )}
            <div>Session: {String(conversation.channelSessionId).slice(0, 12)}...</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Panel 2: Live Transcript */}
        <div className="card" style={{ maxHeight: "500px", overflow: "auto" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Transcript
          </h3>
          {transcripts === undefined && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {transcripts && transcripts.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No transcript yet.</p>
          )}
          {transcripts?.map((t: Transcript) => (
            <div key={t._id} className="transcript-line">
              <span
                className="transcript-speaker"
                style={{ color: t.speaker === "customer" ? "var(--blue)" : "var(--green)" }}
              >
                {t.speaker === "customer" ? "Customer" : "Agent"}
              </span>
              <span style={{ fontSize: "0.875rem" }}>{t.text}</span>
            </div>
          ))}
        </div>

        {/* Panel 3: Agent Actions (governance decisions) */}
        <div className="card" style={{ maxHeight: "500px", overflow: "auto" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Agent Actions
          </h3>
          {actions === undefined && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {actions && actions.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No actions yet.</p>
          )}
          {actions?.map((a: AgentAction) => (
            <div key={a._id} className="action-row">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{a.toolName}</span>
                  {a.policyDecision && (
                    <span className={`badge badge-${a.policyDecision}`}>
                      {a.policyDecision.toUpperCase()}
                    </span>
                  )}
                  {a.armoriqVerified && (
                    <span className="badge" style={{ background: "rgba(34,197,94,0.1)", color: "var(--green)" }}>
                      Verified
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {a.policyReason}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                <div>Conf: {a.confidence?.toFixed(2) ?? "\u2014"}</div>
                <div>Risk: {a.riskScore?.toFixed(2) ?? "\u2014"}</div>
                <div>Thresh: {a.effectiveThreshold?.toFixed(3) ?? "\u2014"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel 4: Conversation Events Timeline */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Timeline
        </h3>
        {events === undefined && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
        {events && events.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No events yet.</p>
        )}
        {events?.map((e: ConversationEvent) => (
          <div key={e._id} className="timeline-item">
            <div style={{ minWidth: "6rem" }}>
              <span className={`badge ${getBadgeClass(e.kind)}`}>
                {formatKind(e.kind)}
              </span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
                  {e.actorKind}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ fontSize: "0.875rem", marginTop: "0.25rem" }}>
                {typeof e.payload === "object" && e.payload !== null
                  ? JSON.stringify(e.payload)
                  : String(e.payload ?? "")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getBadgeClass(kind: string): string {
  switch (kind) {
    case "tool_called": return "badge-allow";
    case "tool_blocked": return "badge-deny";
    case "tool_escalated": return "badge-escalate";
    case "message": return "badge-active";
    default: return "badge-completed";
  }
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
