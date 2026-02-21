"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type CallStatus = "idle" | "connecting" | "active" | "ended";

/**
 * VAPI web widget component.
 * Uses @vapi-ai/web SDK to start a voice call in the browser.
 *
 * Environment variables needed:
 * - NEXT_PUBLIC_VAPI_PUBLIC_KEY
 * - NEXT_PUBLIC_VAPI_ASSISTANT_ID
 */
export function VapiWidget() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const vapiRef = useRef<unknown>(null);

  const startCall = useCallback(async () => {
    try {
      setStatus("connecting");
      setTranscript([]);

      // Dynamic import — @vapi-ai/web is a client-only dependency
      const { default: Vapi } = await import("@vapi-ai/web");

      const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

      if (!publicKey || !assistantId) {
        setTranscript(["Error: VAPI keys not configured. Set NEXT_PUBLIC_VAPI_PUBLIC_KEY and NEXT_PUBLIC_VAPI_ASSISTANT_ID."]);
        setStatus("idle");
        return;
      }

      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setStatus("active");
        setTranscript((prev) => [...prev, "[Call started]"]);
      });

      vapi.on("call-end", () => {
        setStatus("ended");
        setTranscript((prev) => [...prev, "[Call ended]"]);
      });

      vapi.on("speech-start", () => {
        setTranscript((prev) => [...prev, "[Agent speaking...]"]);
      });

      vapi.on("speech-end", () => {
        // Agent finished speaking
      });

      vapi.on("message", (msg: Record<string, unknown>) => {
        if (msg.type === "transcript" && typeof msg.transcript === "string") {
          const role = msg.role === "user" ? "You" : "Agent";
          setTranscript((prev) => [...prev, `${role}: ${msg.transcript}`]);
        }
      });

      vapi.on("error", (err: unknown) => {
        console.error("VAPI error:", err);
        const errMsg = err && typeof err === "object"
          ? JSON.stringify(err, null, 2)
          : String(err);
        setTranscript((prev) => [...prev, `[Error: ${errMsg}]`]);
        setStatus("idle");
      });

      await vapi.start(assistantId, {
        metadata: {
          trustLevel: 2,
          sentiment: "neutral",
          confidence: 0.9,
        },
      });
    } catch (err) {
      console.error("Failed to start VAPI call:", err);
      setTranscript((prev) => [
        ...prev,
        `[Failed to start: ${err instanceof Error ? err.message : String(err)}]`,
      ]);
      setStatus("idle");
    }
  }, []);

  const endCall = useCallback(() => {
    const vapi = vapiRef.current as { stop?: () => void } | null;
    vapi?.stop?.();
    setStatus("ended");
  }, []);

  return (
    <div className="card" style={{ maxWidth: "600px", margin: "0 auto" }}>
      <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>
        Voice Support
      </h3>

      <div style={{ marginBottom: "1rem" }}>
        {status === "idle" && (
          <button onClick={startCall} className="btn btn-primary">
            Talk to Support
          </button>
        )}
        {status === "connecting" && (
          <button disabled className="btn btn-outline" style={{ opacity: 0.6 }}>
            Connecting...
          </button>
        )}
        {status === "active" && (
          <button onClick={endCall} className="btn" style={{ background: "var(--red)", color: "white" }}>
            End Call
          </button>
        )}
        {status === "ended" && (
          <button onClick={startCall} className="btn btn-primary">
            Start New Call
          </button>
        )}
      </div>

      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
        Status: <span className={`badge ${status === "active" ? "badge-active" : "badge-completed"}`}>
          {status}
        </span>
      </div>

      {transcript.length > 0 && (
        <div
          style={{
            background: "var(--bg)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            maxHeight: "300px",
            overflow: "auto",
            fontSize: "0.875rem",
          }}
        >
          {transcript.map((line, i) => (
            <div key={i} style={{ padding: "0.25rem 0", borderBottom: "1px solid var(--border)" }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
