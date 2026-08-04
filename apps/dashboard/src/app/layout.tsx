import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { AppShell } from "@/components/AppShell";
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
          <AppShell>{children}</AppShell>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
