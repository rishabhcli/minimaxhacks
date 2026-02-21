"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/api";
import Link from "next/link";

type ConversationDoc = {
  _id: string;
  channelType: string;
  channelSessionId: string;
  customerId?: string;
  status: string;
  trustLevel: number;
  sentimentScore?: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
};

type Transcript = {
  _id: string;
  speaker: string;
  text: string;
  isFinal: boolean;
  ts: number;
};

type AgentAction = {
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
};

export function ConversationDetail({
  conversationId,
  showBackLink = false,
  onClose,
}: {
  conversationId: string;
  showBackLink?: boolean;
  onClose?: () => void;
}) {
  const conversation = useQuery(api.conversations.getById, { id: conversationId }) as
    | ConversationDoc
    | null
    | undefined;
  const transcripts = useQuery(api.transcripts.byConversation, { conversationId }) as
    | Transcript[]
    | undefined;

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
        <div className="detail-head-left">
          {showBackLink && (
            <Link href="/" className="back-link">
              &larr; Back to conversations
            </Link>
          )}
          <div className="conversation-meta">
            <span
              className={`badge ${
                conversation.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"
              }`}
            >
              {conversation.channelType === "vapi_web" ? "Web (VAPI)" : "Phone (Plivo)"}
            </span>
            <span
              className={`badge ${
                conversation.status === "active" ? "badge-active" : "badge-completed"
              }`}
            >
              {conversation.status}
            </span>
            <span className="badge badge-trust">Trust Level {conversation.trustLevel}</span>
            {conversation.sentimentScore && (
              <span className="badge badge-escalate">{conversation.sentimentScore}</span>
            )}
          </div>
        </div>
        {onClose && (
          <button className="btn btn-outline small" onClick={onClose}>
            Close
          </button>
        )}
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
            <p>
              {conversation.endedAt
                ? new Date(conversation.endedAt).toLocaleString()
                : "In progress"}
            </p>
          </div>
        </div>
      </section>

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
    </div>
  );
}

function getSpeakerClass(speaker: string): string {
  return speaker === "customer" ? "speaker-customer" : "speaker-agent";
}
