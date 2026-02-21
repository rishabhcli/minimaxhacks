import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

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
      <body>
        <ConvexClientProvider>
          <header>
            <div className="inner">
              <h1>ShieldDesk AI</h1>
              <nav style={{ display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
                <a href="/">Conversations</a>
                <a href="/talk">Talk to Support</a>
              </nav>
            </div>
          </header>
          <main className="container">{children}</main>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
