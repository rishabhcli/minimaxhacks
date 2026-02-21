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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Conversations</h2>
        <Link href="/talk" className="btn btn-primary">
          Talk to Support
        </Link>
      </div>

      {conversations === undefined && (
        <p style={{ color: "var(--text-muted)" }}>Loading conversations...</p>
      )}

      {conversations && conversations.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
            No conversations yet. Start one by clicking &quot;Talk to Support&quot;.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {conversations?.map((conv: Conversation) => (
          <Link
            key={conv._id}
            href={`/conversations/${conv._id}`}
            style={{ textDecoration: "none" }}
          >
            <div className="card" style={{ cursor: "pointer", transition: "border-color 0.15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className={`badge ${conv.channelType === "vapi_web" ? "badge-vapi" : "badge-plivo"}`}>
                    {conv.channelType === "vapi_web" ? "Web" : "Phone"}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {conv.customerId ? `Customer ${String(conv.customerId).slice(-6)}` : "Anonymous"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className={`badge ${conv.status === "active" ? "badge-active" : "badge-completed"}`}>
                    {conv.status}
                  </span>
                  <span className="badge" style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent)" }}>
                    Trust {conv.trustLevel}
                  </span>
                  {conv.sentimentScore && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {conv.sentimentScore}
                    </span>
                  )}
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {new Date(conv.startedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
              {conv.summary && (
                <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  {conv.summary}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
