"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type CallStatus = "idle" | "connecting" | "active" | "ended";
type Sentiment = "frustrated" | "neutral" | "satisfied" | "calm";

const SENTIMENT_EMOJI: Record<Sentiment, string> = {
  frustrated: "frustrated",
  neutral: "neutral",
  satisfied: "satisfied",
  calm: "calm",
};

interface VapiWidgetProps {
  trustLevel?: 1 | 2 | 3 | 4;
  sentimentOverride?: Sentiment;
}

/**
 * VAPI web widget component.
 * Uses @vapi-ai/web SDK to start a voice call in the browser.
 */
export function VapiWidget({ trustLevel = 2, sentimentOverride }: VapiWidgetProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [liveSentiment, setLiveSentiment] = useState<Sentiment>("neutral");
  const vapiRef = useRef<unknown>(null);

  // If sentimentOverride changes, update live sentiment display
  useEffect(() => {
    if (sentimentOverride) {
      setLiveSentiment(sentimentOverride);
    }
  }, [sentimentOverride]);

  const startCall = useCallback(async () => {
    try {
      setStatus("connecting");
      setTranscript([]);
      setLiveSentiment(sentimentOverride ?? "neutral");

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
          trustLevel,
          sentiment: sentimentOverride ?? "neutral",
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
  }, [trustLevel, sentimentOverride]);

  const endCall = useCallback(() => {
    const vapi = vapiRef.current as { stop?: () => void } | null;
    vapi?.stop?.();
    setStatus("ended");
  }, []);

  const trustLabels: Record<number, string> = { 1: "Anonymous", 2: "Authenticated", 3: "Premium", 4: "VIP" };

  return (
    <div className="card" style={{ height: "100%" }}>
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

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
        <span>
          Status: <span className={`badge ${status === "active" ? "badge-active" : "badge-completed"}`}>
            {status}
          </span>
        </span>
        <span>
          Sentiment: <span className={`badge ${liveSentiment === "frustrated" ? "badge-deny" : liveSentiment === "calm" || liveSentiment === "satisfied" ? "badge-allow" : "badge-completed"}`}>
            {SENTIMENT_EMOJI[liveSentiment]} {liveSentiment}
          </span>
        </span>
        <span>
          Trust: <span className="badge badge-active">
            {trustLevel} ({trustLabels[trustLevel] ?? "?"})
          </span>
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
