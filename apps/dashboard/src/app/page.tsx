"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  CheckCircle2,
  Clock3,
  FileWarning,
  Headphones,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { PolicySurface } from "@/components/PolicySurface";
import {
  useDashboardData,
  type DashboardAction,
  type DashboardConversation,
  type PolicyDecision,
} from "@/lib/dashboard-data";

const TRUST_LABELS: Record<number, string> = { 1: "Anonymous", 2: "Authenticated", 3: "Premium", 4: "VIP" };

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function decisionFor(action: DashboardAction) {
  if (action.status === "planned" || action.status === "policy_checking" || action.status === "executing") return "pending";
  if (action.policyDecision) return action.policyDecision;
  if (action.status === "failed" || action.status === "blocked") return "deny";
  if (action.status === "escalated") return "escalate";
  return "allow";
}

function DecisionBadge({ decision }: { decision: string }) {
  return <span className={`badge ${decision}`}>{decision}</span>;
}

function ConversationRow({ conversation }: { conversation: DashboardConversation }) {
  const customerName = conversation.customer?.displayName ?? "Unidentified caller";
  const channelLabel = conversation.channelType === "vapi_web" ? "Web voice" : "Phone";
  const active = conversation.status === "active";

  return (
    <Link className="conversation-row" href={`/conversations/${conversation._id}`}>
      <div className="conversation-primary">
        <div className="avatar">{initials(customerName)}</div>
        <div>
          <div className="conversation-name">{customerName}</div>
          <div className="conversation-summary">{conversation.summary ?? "No summary captured yet."}</div>
        </div>
      </div>
      <div className="conversation-secondary">
        <div className="conversation-tags">
          <span className={`badge ${active ? "active" : "completed"}`}>
            <span className="status-dot" />
            {active ? "Live" : conversation.status}
          </span>
          <span className={`badge ${conversation.channelType === "vapi_web" ? "channel-web" : "channel-phone"}`}>
            {channelLabel}
          </span>
          <span className="badge neutral">T{conversation.trustLevel} · {TRUST_LABELS[conversation.trustLevel]}</span>
        </div>
        <div className="conversation-time">
          {conversation.sentimentScore ? `Sentiment: ${conversation.sentimentScore} · ` : ""}{formatTime(conversation.startedAt)}
        </div>
      </div>
      <div className="conversation-actions">
        <span className="text-link">Review <ArrowUpRight size={13} /></span>
      </div>
    </Link>
  );
}

function DecisionRow({ action }: { action: DashboardAction }) {
  const decision = decisionFor(action);
  return (
    <div className="decision-item">
      <span className={`decision-mark ${decision}`} />
      <div>
        <div className="decision-tool">{action.toolName}</div>
        <div className="decision-detail">{action.policyReason ?? "Policy evaluation recorded."}</div>
      </div>
      <div>
        <DecisionBadge decision={decision} />
        <div className="decision-time" style={{ marginTop: 6, textAlign: "right" }}>{formatTime(action.ts)}</div>
      </div>
    </div>
  );
}

function QueueRow({ action }: { action: DashboardAction }) {
  const decision = decisionFor(action);
  return (
    <div className="decision-item">
      <span className={`decision-mark ${decision}`} />
      <div>
        <div className="decision-tool">{action.toolName}</div>
        <div className="decision-detail">{action.policyReason ?? "Awaiting a human decision."}</div>
      </div>
      <Link className="text-link" href={action.conversationId ? `/conversations/${action.conversationId}` : "/"}>
        Open <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

type FilterState = {
  query: string;
  status: "all" | "active" | "completed" | "failed";
  channel: "all" | "vapi_web" | "plivo_phone";
  trust: "all" | "1" | "2" | "3" | "4";
  sentiment: "all" | "frustrated" | "neutral" | "satisfied" | "calm";
  decision: "all" | PolicyDecision | "pending";
};

const DEFAULT_FILTERS: FilterState = {
  query: "",
  status: "all",
  channel: "all",
  trust: "all",
  sentiment: "all",
  decision: "all",
};

function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const hasFilters = filters.query.trim().length > 0 || Object.entries(filters)
    .filter(([key]) => key !== "query")
    .some(([, value]) => value !== "all");

  return (
    <div className="filter-bar" aria-label="Conversation filters">
      <label className="filter-search">
        <Search size={14} />
        <span className="sr-only">Search conversations</span>
        <input
          className="filter-input"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Search people, summaries, tools"
        />
      </label>
      <label className="filter-field">
        <span>Status</span>
        <select className="filter-select" value={filters.status} onChange={(event) => onChange({ status: event.target.value as FilterState["status"] })}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Channel</span>
        <select className="filter-select" value={filters.channel} onChange={(event) => onChange({ channel: event.target.value as FilterState["channel"] })}>
          <option value="all">All channels</option>
          <option value="vapi_web">Web voice</option>
          <option value="plivo_phone">Phone</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Trust</span>
        <select className="filter-select" value={filters.trust} onChange={(event) => onChange({ trust: event.target.value as FilterState["trust"] })}>
          <option value="all">All levels</option>
          <option value="1">T1 Anonymous</option>
          <option value="2">T2 Authenticated</option>
          <option value="3">T3 Premium</option>
          <option value="4">T4 VIP</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Sentiment</span>
        <select className="filter-select" value={filters.sentiment} onChange={(event) => onChange({ sentiment: event.target.value as FilterState["sentiment"] })}>
          <option value="all">All sentiment</option>
          <option value="frustrated">Frustrated</option>
          <option value="neutral">Neutral</option>
          <option value="satisfied">Satisfied</option>
          <option value="calm">Calm</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Decision</span>
        <select className="filter-select" value={filters.decision} onChange={(event) => onChange({ decision: event.target.value as FilterState["decision"] })}>
          <option value="all">All decisions</option>
          <option value="allow">Allow</option>
          <option value="escalate">Escalate</option>
          <option value="deny">Deny</option>
          <option value="pending">Pending</option>
        </select>
      </label>
      <button className="filter-reset" type="button" onClick={onReset} disabled={!hasFilters} title="Clear filters">
        <RotateCcw size={13} />
        Clear
      </button>
    </div>
  );
}

export default function HomePage() {
  const { dataSource, isLoading, conversations, actions, tickets } = useDashboardData();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const activeConversations = conversations.filter((conversation) => conversation.status === "active");
  const governedCount = actions.length;
  const allowedCount = actions.filter((action) => decisionFor(action) === "allow").length;
  const pendingActions = actions.filter((action) => decisionFor(action) === "escalate");
  const activeSession = activeConversations[0] ?? conversations[0];
  const filteredConversations = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filters.status !== "all" && conversation.status !== filters.status) return false;
      if (filters.channel !== "all" && conversation.channelType !== filters.channel) return false;
      if (filters.trust !== "all" && String(conversation.trustLevel) !== filters.trust) return false;
      if (filters.sentiment !== "all" && conversation.sentimentScore !== filters.sentiment) return false;

      const relatedActions = actions.filter((action) => action.conversationId === conversation._id);
      if (filters.decision !== "all" && !relatedActions.some((action) => decisionFor(action) === filters.decision)) return false;
      if (!query) return true;

      const searchable = [
        conversation.customer?.displayName,
        conversation.customer?.email,
        conversation.summary,
        conversation.channelType,
        ...relatedActions.map((action) => action.toolName),
        ...relatedActions.map((action) => action.policyReason),
      ].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [actions, conversations, filters]);

  const filteredConversationIds = useMemo(() => new Set(filteredConversations.map((conversation) => conversation._id)), [filteredConversations]);
  const filteredActions = useMemo(() => actions.filter((action) => {
    const relatedConversationMatches = !action.conversationId || filteredConversationIds.has(action.conversationId);
    return relatedConversationMatches && (filters.decision === "all" || decisionFor(action) === filters.decision);
  }), [actions, filteredConversationIds, filters.decision]);
  const filteredPendingActions = filteredActions.filter((action) => decisionFor(action) === "escalate");

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">ShieldDesk / Operations</div>
          <h1 className="page-title">Command center</h1>
          <p className="page-description">Watch customer conversations, policy decisions, and human review queues from one governed surface.</p>
        </div>
        <div className="page-actions">
          <Link className="button button-ghost" href="/talk">
            <AudioLines size={15} />
            Open voice lab
          </Link>
        </div>
      </div>

      {dataSource === "preview" && (
        <div className="data-notice" style={{ marginBottom: 18 }}>
          <FileWarning size={15} />
          <span><strong>Local preview dataset.</strong> Add NEXT_PUBLIC_CONVEX_URL to switch this surface to live subscriptions.</span>
        </div>
      )}

      <div className="metric-grid">
        <div className="metric-card accent">
          <div className="metric-topline"><span className="metric-label">Active sessions</span><span className="metric-icon"><Headphones size={15} /></span></div>
          <div className="metric-value">{isLoading ? "—" : activeConversations.length}</div>
          <div className="metric-footnote positive">{activeConversations.length ? "Live attention required" : "No calls in progress"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-topline"><span className="metric-label">Governed actions</span><span className="metric-icon"><ShieldCheck size={15} /></span></div>
          <div className="metric-value">{isLoading ? "—" : governedCount}</div>
          <div className="metric-footnote">Policy checks recorded</div>
        </div>
        <div className="metric-card">
          <div className="metric-topline"><span className="metric-label">Auto-approved</span><span className="metric-icon"><CheckCircle2 size={15} /></span></div>
          <div className="metric-value">{isLoading || !governedCount ? "—" : `${Math.round((allowedCount / governedCount) * 100)}%`}</div>
          <div className="metric-footnote positive">{allowedCount} actions cleared the boundary</div>
        </div>
        <div className="metric-card">
          <div className="metric-topline"><span className="metric-label">Pending review</span><span className="metric-icon"><Clock3 size={15} /></span></div>
          <div className="metric-value">{isLoading ? "—" : pendingActions.length}</div>
          <div className="metric-footnote warning">{tickets.length} open support ticket{tickets.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="content-grid">
        <div className="main-column">
          <section className="panel" id="sessions">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Conversation watch</h2>
                <p className="panel-subtitle">The latest customer sessions, ordered by start time</p>
              </div>
              <span className="panel-meta">{filteredConversations.length}/{conversations.length} tracked</span>
            </div>
            <FilterBar filters={filters} onChange={(next) => setFilters((current) => ({ ...current, ...next }))} onReset={() => setFilters(DEFAULT_FILTERS)} />
            {isLoading ? (
              <div className="loading-state"><div className="skeleton" style={{ width: "42%", margin: "0 auto" }} /><p>Subscribing to conversation state…</p></div>
            ) : filteredConversations.length ? (
              <div className="conversation-list">{filteredConversations.map((conversation) => <ConversationRow key={conversation._id} conversation={conversation} />)}</div>
            ) : (
              <div className="empty-state"><SlidersHorizontal size={22} color="var(--faint)" /><strong>{conversations.length ? "No matching conversations" : "No conversations yet"}</strong><p>{conversations.length ? "Adjust the filters to widen the watch list." : "Start a voice session to see the governed transcript and action trail appear here."}</p></div>
            )}
          </section>

          <section className="panel" id="queue">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Decision queue</h2>
                <p className="panel-subtitle">Actions that need a human to confirm the next step</p>
              </div>
              <span className="panel-meta">{filteredPendingActions.length} waiting</span>
            </div>
            {filteredPendingActions.length ? <div className="decision-list">{filteredPendingActions.map((action) => <QueueRow key={action._id} action={action} />)}</div> : <div className="empty-state"><CheckCircle2 size={22} color="var(--mint)" /><strong>Queue is clear</strong><p>Nothing is waiting for human review right now.</p></div>}
          </section>
        </div>

        <div className="side-column">
          <PolicySurface trustLevel={activeSession?.trustLevel ?? 2} sentiment={activeSession?.sentimentScore ?? "neutral"} actions={actions.slice(0, 4)} />
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Recent decisions</h2>
                <p className="panel-subtitle">An explainable audit stream</p>
              </div>
              <ShieldCheck size={17} color="var(--mint)" />
            </div>
            {filteredActions.length ? <div className="decision-list">{filteredActions.slice(0, 5).map((action) => <DecisionRow key={action._id} action={action} />)}</div> : <div className="empty-state"><ShieldCheck size={22} color="var(--faint)" /><strong>No decisions recorded</strong><p>Governance events will show up as tools are called.</p></div>}
          </section>
        </div>
      </div>
    </div>
  );
}
