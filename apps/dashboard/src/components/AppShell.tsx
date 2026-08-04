"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AudioLines,
  BookOpen,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useDashboardData } from "@/lib/dashboard-data";
import { useApiHealth } from "@/lib/api-health";

const NAV_ITEMS = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Voice lab", href: "/talk", icon: AudioLines },
  { label: "Decision queue", href: "/#queue", icon: Activity },
  { label: "Policy rules", href: "/talk#policy", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { dataSource } = useDashboardData();
  const apiHealth = useApiHealth();
  const isLive = dataSource === "live";
  const apiLabel = apiHealth.status === "ready"
    ? "API ready"
    : apiHealth.status === "degraded"
      ? "API degraded"
      : apiHealth.status === "offline"
        ? "API offline"
        : apiHealth.status === "unconfigured"
          ? "API not configured"
        : "API checking";
  const apiTitle = apiHealth.health?.degraded?.length
    ? `Degraded: ${apiHealth.health.degraded.join(", ")}`
    : "API configuration health";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">ShieldDesk</div>
            <div className="brand-subtitle">Control plane</div>
          </div>
        </div>

        <div className="sidebar-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/"
              ? pathname === "/"
              : item.href.startsWith("/#")
                ? pathname === "/"
                : pathname.startsWith(item.href.split("#")[0]);
            return (
              <Link key={item.label} className={`nav-item${active ? " active" : ""}`} href={item.href}>
                <Icon size={16} strokeWidth={1.9} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-status">
          <div className="sidebar-status-line">
            <span className="status-dot" style={{ color: isLive ? "var(--mint)" : "var(--orange)" }} />
            {isLive ? "Live data connected" : "Preview data loaded"}
          </div>
          <small>Policy engine · v1.0</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context">
            <strong>Operations</strong>
            <span className="topbar-divider">/</span>
            <span>{pathname === "/talk" ? "Voice lab" : pathname.startsWith("/conversations/") ? "Conversation review" : "Overview"}</span>
          </div>
          <div className="topbar-actions">
            <div className={`connection-pill ${isLive ? "live" : "preview"}`}>
              <span className="status-dot" />
              {isLive ? "Convex connected" : "Local preview"}
            </div>
            <div
              className={`connection-pill api-${apiHealth.status}`}
              title={apiTitle}
            >
              <span className="status-dot" />
              {apiLabel}
            </div>
            <div className="topbar-time">08.04.26 / PST</div>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
