"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/api";
import Link from "next/link";

interface Conversation {
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
}

interface Transcript {
  _id: string;
  speaker: "customer" | "agent";
  text: string;
  isFinal: boolean;
  ts: number;
}

export default function HomePage() {
  const conversations = useQuery(api.conversations.list) as Conversation[] | undefined;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedPastId, setSelectedPastId] = useState<string | null>(null);

  const total = conversations?.length ?? 0;
  const active = conversations?.filter((conv) => conv.status === "active").length ?? 0;
  const web = conversations?.filter((conv) => conv.channelType === "vapi_web").length ?? 0;
  const phone = total - web;
  const averageTrust = total > 0
    ? (
        conversations!.reduce((sum, conv) => sum + conv.trustLevel, 0) / total
      ).toFixed(2)
    : "0.00";

  const pastConversations = useMemo(
    () => (conversations ?? []).filter((conv) => conv.status !== "active"),
    [conversations]
  );

  const selectedPastConversation = useMemo(() => {
    if (pastConversations.length === 0) return null;
    return (
      pastConversations.find((conv) => conv._id === selectedPastId) ??
      pastConversations[0]
    );
  }, [pastConversations, selectedPastId]);

  return (
    <div className="page-stack">
      <section className="hero">
        <h2>Support Operations Console</h2>
        <p>
          Monitor governed customer conversations in real time, inspect policy decisions,
          and launch a new support call when escalation is needed.
        </p>
        <div className="hero-row">
          <span className="metric-chip">
            <span className="metric-dot live" />
            Active {active}
          </span>
          <span className="metric-chip">
            <span className="metric-dot web" />
            Web {web}
          </span>
          <span className="metric-chip">
            <span className="metric-dot phone" />
            Phone {phone}
          </span>
          <span className="metric-chip">
            <span className="metric-dot trust" />
            Avg Trust {averageTrust}
          </span>
        </div>
      </section>

      <div className="section-title">
        <span>Conversations</span>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (!selectedPastId && pastConversations[0]) {
                setSelectedPastId(pastConversations[0]._id);
              }
              setHistoryOpen(true);
            }}
            disabled={pastConversations.length === 0}
          >
            Past Conversations ({pastConversations.length})
          </button>
          <Link href="/talk" className="btn btn-primary">
            Talk to Support
          </Link>
        </div>
      </div>

      {conversations === undefined && (
        <div className="card empty-state">
          <strong>Loading conversations</strong>
          Connecting to the Convex stream.
        </div>
      )}

      {conversations && conversations.length === 0 && (
        <div className="card empty-state">
          <strong>No conversations yet</strong>
          Start one by clicking <em>Talk to Support</em>.
        </div>
      )}

      <div className="list-stack">
        {conversations?.map((conv: Conversation) => (
          <Link key={conv._id} href={`/conversations/${conv._id}`} className="card card-hover conversation-card">
            <div className="conversation-main">
              <div className="conversation-meta">
                <span className={`badge ${conv.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
                  {conv.channelType === "vapi_web" ? "Web" : "Phone"}
                </span>
                <span className={`badge ${conv.status === "active" ? "badge-active" : "badge-completed"}`}>
                  {conv.status}
                </span>
                <span className="badge badge-trust">Trust {conv.trustLevel}</span>
                {conv.sentimentScore && (
                  <span className="badge badge-escalate">{conv.sentimentScore}</span>
                )}
              </div>
              <div className="conversation-meta">
                <span className="meta-time">{new Date(conv.startedAt).toLocaleString()}</span>
              </div>
            </div>

            <div className="conversation-main">
              <strong>
                {conv.customerId ? `Customer ${String(conv.customerId).slice(-6)}` : "Anonymous customer"}
              </strong>
              <span className="section-caption">Session {String(conv.channelSessionId).slice(0, 14)}...</span>
            </div>

            {conv.summary && <p className="summary-text">{conv.summary}</p>}
          </Link>
        ))}
      </div>

      {historyOpen && (
        <div className="history-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="card history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="history-head">
              <div>
                <h3>Past Conversations</h3>
                <p className="summary-text">Browse completed calls and replay transcripts.</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>

            <div className="history-grid">
              <div className="history-list">
                {pastConversations.length === 0 && (
                  <p className="summary-text">No completed calls yet.</p>
                )}
                {pastConversations.map((conv) => (
                  <button
                    key={conv._id}
                    type="button"
                    className={`history-row ${selectedPastConversation?._id === conv._id ? "history-row-active" : ""}`}
                    onClick={() => setSelectedPastId(conv._id)}
                  >
                    <div className="conversation-meta">
                      <span className={`badge ${conv.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
                        {conv.channelType === "vapi_web" ? "Web" : "Phone"}
                      </span>
                      <span className="badge badge-completed">{conv.status}</span>
                    </div>
                    <strong>{new Date(conv.startedAt).toLocaleString()}</strong>
                    <span className="section-caption">
                      Session {String(conv.channelSessionId).slice(0, 14)}...
                    </span>
                  </button>
                ))}
              </div>

              <div className="history-panel">
                {selectedPastConversation ? (
                  <PastConversationReplay conversation={selectedPastConversation} />
                ) : (
                  <div className="empty-state">
                    <strong>Select a conversation</strong>
                    Choose a past conversation to view transcript replay.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PastConversationReplay({ conversation }: { conversation: Conversation }) {
  const transcripts = useQuery(api.transcripts.byConversation, {
    conversationId: conversation._id,
  }) as Transcript[] | undefined;

  const finalTurns = (transcripts ?? []).filter((entry) => entry.isFinal);

  return (
    <div className="history-replay">
      <div className="section-title">
        <span>Replay</span>
        <Link href={`/conversations/${conversation._id}`} className="btn btn-outline">
          Full Audit View
        </Link>
      </div>

      <div className="conversation-meta">
        <span className={`badge ${conversation.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
          {conversation.channelType === "vapi_web" ? "Web (VAPI)" : "Phone"}
        </span>
        <span className="badge badge-completed">{conversation.status}</span>
        <span className="badge badge-trust">Trust {conversation.trustLevel}</span>
      </div>

      <p className="summary-text">
        Started {new Date(conversation.startedAt).toLocaleString()}
        {conversation.endedAt ? ` · Ended ${new Date(conversation.endedAt).toLocaleString()}` : ""}
      </p>

      {conversation.summary && (
        <p className="summary-text history-summary">{conversation.summary}</p>
      )}

      {transcripts === undefined && (
        <div className="empty-state">
          <strong>Loading transcript</strong>
          Fetching stored conversation turns.
        </div>
      )}

      {transcripts && finalTurns.length === 0 && (
        <div className="empty-state">
          <strong>No transcript stored</strong>
          This call ended without final transcript turns.
        </div>
      )}

      {finalTurns.length > 0 && (
        <div className="transcript-log history-transcript-log">
          {finalTurns.map((entry) => (
            <div key={entry._id} className="log-line history-log-line">
              <span className={`transcript-speaker ${entry.speaker === "customer" ? "speaker-customer" : "speaker-agent"}`}>
                {entry.speaker === "customer" ? "You" : "Agent"}
              </span>
              <span>{entry.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
