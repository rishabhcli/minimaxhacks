"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LockKeyhole,
  MessageSquare,
  Phone,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { PolicySurface } from "@/components/PolicySurface";
import { ConversationDetailProvider, useConversationDetailData, type DashboardAction, type DashboardEvent } from "@/lib/dashboard-data";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatDuration(startedAt: number, endedAt?: number) {
  const duration = Math.max(0, (endedAt ?? startedAt + 4 * 60 * 1000) - startedAt);
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function actionDecision(action: DashboardAction) {
  if (action.status === "planned" || action.status === "policy_checking" || action.status === "executing") return "pending";
  if (action.policyDecision) return action.policyDecision;
  if (action.status === "failed" || action.status === "blocked") return "deny";
  if (action.status === "escalated") return "escalate";
  return "allow";
}

const SENSITIVE_KEY = /email|phone|token|secret|password|authorization|address/i;

function redactForDisplay(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (Array.isArray(value)) return value.map((entry) => redactForDisplay(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactForDisplay(entryValue, entryKey)]));
  }
  return value;
}

function formatAuditPayload(value: unknown) {
  try {
    return JSON.stringify(redactForDisplay(value));
  } catch {
    return "[unavailable]";
  }
}

function eventCopy(event: DashboardEvent) {
  const payload = event.payload ?? {};
  const tool = typeof payload.toolName === "string" ? payload.toolName : "tool action";
  switch (event.kind) {
    case "trust_resolved":
      return `Trust level ${String(payload.trustLevel ?? "resolved")} attached to this session.`;
    case "tool_called":
      return `${tool} cleared policy and executed.`;
    case "tool_escalated":
      return `${tool} paused for human review.`;
    case "tool_blocked":
      return `${tool} was blocked before execution.`;
    case "tool_failed":
      return `${tool} failed without bypassing policy.`;
    case "sentiment_changed":
      return `Sentiment moved to ${String(payload.current ?? "updated")}.`;
    case "summary_generated":
      return "Post-call summary generated.";
    case "channel_event":
      return `Channel event: ${String(payload.messageType ?? "updated")}.`;
    default:
      return typeof payload.text === "string" ? payload.text : "Conversation event recorded.";
  }
}

function EventDot({ event }: { event: DashboardEvent }) {
  const tone = event.kind === "tool_escalated" ? "warning" : event.kind === "tool_blocked" || event.kind === "tool_failed" ? "danger" : "";
  return <span className={`timeline-dot ${tone}`} />;
}

function ActionRow({ action, preview }: { action: DashboardAction; preview: boolean }) {
  const decision = actionDecision(action);
  return (
    <div className="action-row">
      <div className="action-heading">
        <span className="action-tool">{action.toolName}</span>
        <span className={`badge ${decision}`}>{decision}</span>
      </div>
      <div className="action-meta">
        <span className="badge">confidence {action.confidence?.toFixed(2) ?? "—"}</span>
        <span className="badge">risk {action.riskScore?.toFixed(2) ?? "—"}</span>
        <span className="badge">threshold {action.effectiveThreshold?.toFixed(3) ?? "—"}</span>
        {action.status && <span className="badge neutral">{action.status.replace("_", " ")}</span>}
      </div>
      {action.policyReason && <p className="action-reason">{action.policyReason}</p>}
      {action.toolArgs && <div className="action-payload"><span className="action-payload-label">Arguments</span><code>{formatAuditPayload(action.toolArgs)}</code></div>}
      {action.result !== undefined && <div className="action-payload"><span className="action-payload-label">Result</span><code>{formatAuditPayload(action.result)}</code></div>}
      {action.armoriqVerified && !preview && (
        <div className="action-proof"><LockKeyhole size={13} /> Cryptographic proof verified · {action.armoriqTokenId ?? "token attached"}</div>
      )}
      {action.armoriqVerified && preview && (
        <div className="action-proof" style={{ color: "var(--orange)" }}><LockKeyhole size={13} /> Preview record · ArmorIQ proof is illustrative only.</div>
      )}
      {!action.armoriqVerified && decision === "allow" && <div className="action-proof" style={{ color: "var(--orange)" }}><CircleAlert size={13} /> Policy allowed; external proof not configured for this action.</div>}
    </div>
  );
}

function ConversationDetailContent() {
  const { dataSource, isLoading, conversation, customer, transcripts, actions, events } = useConversationDetailData();

  if (isLoading) {
    return <div className="loading-state"><div className="skeleton" style={{ width: "34%", margin: "0 auto" }} /><p>Loading conversation state…</p></div>;
  }

  if (!conversation) {
    return <div className="panel not-found"><div><CircleAlert size={25} color="var(--orange)" /><strong>Conversation not found</strong><p>This session may have been removed or the link is incomplete.</p><Link className="text-link" href="/" style={{ marginTop: 16 }}>Back to overview <ArrowLeft size={13} /></Link></div></div>;
  }

  const isActive = conversation.status === "active";
  const customerName = customer?.displayName ?? "Unidentified caller";
  const channelLabel = conversation.channelType === "vapi_web" ? "Web voice" : "Phone";

  return (
    <div>
      <div className="detail-header">
        <Link className="back-link" href="/"><ArrowLeft size={14} /> Back to command center</Link>
        <div className="detail-title-row">
          <div className="detail-title-group">
            <div className="eyebrow">Conversation review / {conversation.channelSessionId.slice(0, 18)}</div>
            <h1 className="detail-title">{customerName}</h1>
            <p className="detail-subtitle">{channelLabel} · started {formatDate(conversation.startedAt)} · duration {formatDuration(conversation.startedAt, conversation.endedAt)}</p>
          </div>
          <div className="detail-badges">
            <span className={`badge ${isActive ? "active" : "completed"}`}><span className="status-dot" /> {conversation.status}</span>
            <span className="badge channel-web">Trust {conversation.trustLevel}</span>
            {conversation.sentimentScore && <span className="badge warning">{conversation.sentimentScore}</span>}
          </div>
        </div>
      </div>

      {dataSource === "preview" && (
        <div className="data-notice" style={{ marginBottom: 16 }}>
          <CircleAlert size={15} />
          <span><strong>Local preview session.</strong> Live transcript and audit records appear here once Convex is connected.</span>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel transcript-panel">
            <div className="panel-header">
              <div><h2 className="panel-title">Transcript</h2><p className="panel-subtitle">Conversation messages, ordered oldest first</p></div>
              <MessageSquare size={17} color="var(--sky)" />
            </div>
            {transcripts.length ? (
              <div className="transcript-list">
                {transcripts.map((transcript) => (
                  <div className={`transcript-line ${transcript.speaker}`} key={transcript._id}>
                    <span className="transcript-speaker">{transcript.speaker}</span>
                    <span className="transcript-text">{transcript.text}</span>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><MessageSquare size={22} color="var(--faint)" /><strong>No transcript captured</strong><p>Messages will stream into this review as the call progresses.</p></div>}
          </section>

          <section className="panel action-panel">
            <div className="panel-header">
              <div><h2 className="panel-title">Governed actions</h2><p className="panel-subtitle">Every attempted tool call with its evidence</p></div>
              <ShieldCheck size={17} color="var(--mint)" />
            </div>
            {actions.length ? <div className="action-list">{actions.map((action) => <ActionRow action={action} preview={dataSource === "preview"} key={action._id} />)}</div> : <div className="empty-state"><ShieldCheck size={22} color="var(--faint)" /><strong>No tool calls yet</strong><p>Low-risk lookups and higher-impact requests will be logged here.</p></div>}
          </section>
        </div>

        <div className="detail-side">
          <PolicySurface trustLevel={conversation.trustLevel} sentiment={conversation.sentimentScore ?? "neutral"} actions={actions} />

          <section className="panel timeline-panel">
            <div className="panel-header">
              <div><h2 className="panel-title">Audit timeline</h2><p className="panel-subtitle">System events for this session</p></div>
              <Clock3 size={17} color="var(--orange)" />
            </div>
            {events.length ? (
              <div className="timeline-list">
                {events.map((event) => (
                  <div className="timeline-entry" key={event._id}>
                    <EventDot event={event} />
                    <div>
                      <div className="timeline-kind">{event.kind.replaceAll("_", " ")}</div>
                      <div className="timeline-copy">{eventCopy(event)}</div>
                      <div className="timeline-time">{formatDate(event.ts)} · {event.actorKind}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><Clock3 size={22} color="var(--faint)" /><strong>No audit events yet</strong><p>Session events will appear as the call is processed.</p></div>}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h2 className="panel-title">Session context</h2><p className="panel-subtitle">Identity and channel details</p></div>
              {conversation.channelType === "vapi_web" ? <Radio size={17} color="var(--sky)" /> : <Phone size={17} color="var(--acid)" />}
            </div>
            <div className="guardrail-list">
              <div className="guardrail-row"><span>Customer</span><strong style={{ marginLeft: "auto", color: "var(--ink-soft)", fontSize: 11 }}>{customerName}</strong></div>
              <div className="guardrail-row"><span>Account tier</span><strong style={{ marginLeft: "auto", color: "var(--ink-soft)", fontSize: 11 }}>{customer?.tier ?? "unresolved"}</strong></div>
              <div className="guardrail-row"><span>Session ID</span><strong style={{ marginLeft: "auto", color: "var(--faint)", fontFamily: "SFMono-Regular, Consolas, monospace", fontSize: 10 }}>{conversation.channelSessionId.slice(0, 14)}…</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  return <ConversationDetailProvider id={id}><ConversationDetailContent /></ConversationDetailProvider>;
}
