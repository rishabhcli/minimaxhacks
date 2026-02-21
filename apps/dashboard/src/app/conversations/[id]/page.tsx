"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/api";
import { useParams } from "next/navigation";
import Link from "next/link";

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
    return (
      <div className="card empty-state">
        <strong>Loading conversation</strong>
        Waiting for live conversation data.
      </div>
    );
  }

  if (conversation === null) {
    return (
      <div className="card empty-state">
        <strong>Conversation not found</strong>
        The record may have been removed or the ID is invalid.
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="detail-head">
        <Link href="/" className="back-link">
          &larr; Back to conversations
        </Link>
        <div className="conversation-meta">
          <span className={`badge ${conversation.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
            {conversation.channelType === "vapi_web" ? "Web (VAPI)" : "Phone (Plivo)"}
          </span>
          <span className={`badge ${conversation.status === "active" ? "badge-active" : "badge-completed"}`}>
            {conversation.status}
          </span>
          <span className="badge badge-trust">Trust Level {conversation.trustLevel}</span>
          {conversation.sentimentScore && (
            <span className="badge badge-escalate">{conversation.sentimentScore}</span>
          )}
        </div>
      </div>

      <section className="card">
        <div className="section-title">
          <span>Conversation Context</span>
          <span className="section-caption">
            Session {String(conversation.channelSessionId).slice(0, 18)}...
          </span>
        </div>
        <div className="grid-3">
          <div className="stat-block">
            <p className="section-caption">Started</p>
            <p>{new Date(conversation.startedAt).toLocaleString()}</p>
          </div>
          <div className="stat-block">
            <p className="section-caption">Ended</p>
            <p>{conversation.endedAt ? new Date(conversation.endedAt).toLocaleString() : "In progress"}</p>
          </div>
          <div className="stat-block">
            <p className="section-caption">Customer</p>
            <p>{conversation.customerId ? String(conversation.customerId) : "Anonymous"}</p>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="section-title">
            <span>Transcript</span>
            <span className="section-caption">{transcripts?.length ?? 0} turns</span>
          </div>
          <div className="scroll-panel">
            {transcripts === undefined && <p className="summary-text">Loading transcript...</p>}
            {transcripts && transcripts.length === 0 && <p className="summary-text">No transcript yet.</p>}
            {transcripts?.map((t: Transcript) => (
              <div key={t._id} className="transcript-line">
                <span className={`transcript-speaker ${getSpeakerClass(t.speaker)}`}>
                  {t.speaker === "customer" ? "Customer" : "Agent"}
                </span>
                <div>
                  <p>{t.text}</p>
                  <p className="section-caption">{new Date(t.ts).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="section-title">
            <span>Agent Actions</span>
            <span className="section-caption">{actions?.length ?? 0} calls</span>
          </div>
          <div className="scroll-panel">
            {actions === undefined && <p className="summary-text">Loading actions...</p>}
            {actions && actions.length === 0 && <p className="summary-text">No actions yet.</p>}
            {actions?.map((a: AgentAction) => (
              <div key={a._id} className="action-row">
                <div>
                  <div className="conversation-meta">
                    <span className="badge badge-completed">{a.toolName}</span>
                    {a.policyDecision && (
                      <span className={`badge badge-${a.policyDecision}`}>
                        {a.policyDecision.toUpperCase()}
                      </span>
                    )}
                    {a.armoriqVerified && <span className="badge badge-verified">Verified</span>}
                  </div>
                  <p className="summary-text">{a.policyReason || "No policy reason available."}</p>
                </div>
                <div className="metrics-col">
                  <div>Conf: {a.confidence?.toFixed(2) ?? "\u2014"}</div>
                  <div>Risk: {a.riskScore?.toFixed(2) ?? "\u2014"}</div>
                  <div>Thresh: {a.effectiveThreshold?.toFixed(3) ?? "\u2014"}</div>
                  <div>Status: {a.status}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="section-title">
          <span>Timeline</span>
          <span className="section-caption">{events?.length ?? 0} events</span>
        </div>
        <div className="scroll-panel">
          {events === undefined && <p className="summary-text">Loading timeline...</p>}
          {events && events.length === 0 && <p className="summary-text">No events yet.</p>}
          {events?.map((e: ConversationEvent) => (
            <div key={e._id} className="timeline-item">
              <div className="conversation-meta">
                <span className={`badge ${getBadgeClass(e.kind)}`}>{formatKind(e.kind)}</span>
                <span className="section-caption">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              <div>
                <p className="section-caption">{e.actorKind}</p>
                <pre className="event-body">{formatPayload(e.payload)}</pre>
              </div>
            </div>
          ))}
        </div>
      </section>
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

function getSpeakerClass(speaker: string): string {
  return speaker === "customer" ? "speaker-customer" : "speaker-agent";
}

function formatPayload(payload: unknown): string {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
