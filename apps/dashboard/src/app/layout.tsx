import type { Metadata } from "next";
import Link from "next/link";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShieldDesk AI — Dashboard",
  description: "Governance-first voice customer support agent dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${monoFont.variable}`}>
        <div className="app-shell">
          <div className="ambient-layer" aria-hidden="true">
            <div className="ambient-orb ambient-orb-a" />
            <div className="ambient-orb ambient-orb-b" />
            <div className="ambient-grid" />
          </div>
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark">SD</span>
                <span>
                  <strong>ShieldDesk</strong>
                  <small>Governed Support Console</small>
                </span>
              </Link>
              <nav className="topnav">
                <Link href="/" className="nav-link">
                  Conversations
                </Link>
                <Link href="/talk" className="nav-link nav-link-accent">
                  Talk to Support
                </Link>
              </nav>
              <p className="topbar-note">Live audit trail + policy surface</p>
            </div>
          </header>
          <main className="container page-entry">{children}</main>
        </div>
      </body>
    </html>
  );
}
