"use client";

import { useEffect, useState } from "react";

type ApiHealthPayload = {
  readiness?: "degraded" | "configured";
  degraded?: string[];
  requestId?: string;
};

export type ApiHealthState = {
  status: "checking" | "ready" | "degraded" | "offline" | "unconfigured";
  health?: ApiHealthPayload;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? null;

export function useApiHealth(): ApiHealthState {
  const [state, setState] = useState<ApiHealthState>({ status: "checking" });

  useEffect(() => {
    let disposed = false;

    if (!API_URL) {
      setState({ status: "unconfigured" });
      return () => {
        disposed = true;
      };
    }

    const check = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2_500);

      try {
        const response = await fetch(`${API_URL}/health`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`API health returned ${response.status}`);

        const health = (await response.json()) as ApiHealthPayload;
        if (!disposed) {
          setState({
            status: health.readiness === "configured" ? "ready" : "degraded",
            health,
          });
        }
      } catch {
        if (!disposed) setState({ status: "offline" });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
