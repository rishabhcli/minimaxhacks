"use client";

import { type ReactNode } from "react";
import { DashboardDataProvider } from "@/lib/dashboard-data";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <DashboardDataProvider>{children}</DashboardDataProvider>;
}
