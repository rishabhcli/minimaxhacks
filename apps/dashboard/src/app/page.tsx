"use client";

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

export default function HomePage() {
  const conversations = useQuery(api.conversations.list) as Conversation[] | undefined;
  const total = conversations?.length ?? 0;
  const active = conversations?.filter((conv) => conv.status === "active").length ?? 0;
  const web = conversations?.filter((conv) => conv.channelType === "vapi_web").length ?? 0;
  const phone = total - web;
  const averageTrust = total > 0
    ? (
        conversations!.reduce((sum, conv) => sum + conv.trustLevel, 0) / total
      ).toFixed(2)
    : "0.00";

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
        <Link href="/talk" className="btn btn-primary">
          Talk to Support
        </Link>
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
    </div>
  );
}
