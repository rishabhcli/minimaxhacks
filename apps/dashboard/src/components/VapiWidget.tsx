"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, Mic, Phone, PhoneOff, ShieldCheck } from "lucide-react";

type CallStatus = "idle" | "connecting" | "active" | "ended";
type Sentiment = "frustrated" | "neutral" | "satisfied" | "calm";

interface TranscriptLine {
  role: "customer" | "agent" | "system";
  text: string;
}

interface VapiWidgetProps {
  trustLevel?: 1 | 2 | 3 | 4;
  sentimentOverride?: Sentiment;
  demoContext?: boolean;
}

const TRUST_LABELS: Record<number, string> = { 1: "Anonymous", 2: "Authenticated", 3: "Premium", 4: "VIP" };

export function VapiWidget({ trustLevel = 1, sentimentOverride, demoContext = false }: VapiWidgetProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [liveSentiment, setLiveSentiment] = useState<Sentiment>(sentimentOverride ?? "neutral");
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<unknown>(null);

  useEffect(() => {
    if (sentimentOverride) setLiveSentiment(sentimentOverride);
  }, [sentimentOverride]);

  const startCall = useCallback(async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
    if (!publicKey || !assistantId) {
      setError("VAPI is not configured in this checkout. Add the public key and assistant ID to start a real call.");
      return;
    }

    try {
      setError(null);
      setStatus("connecting");
      setTranscript([]);
      setLiveSentiment(sentimentOverride ?? "neutral");

      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setStatus("active");
        setTranscript((previous) => [...previous, { role: "system", text: "Secure voice channel opened." }]);
      });

      vapi.on("call-end", () => {
        setStatus("ended");
        setTranscript((previous) => [...previous, { role: "system", text: "Voice channel closed. Audit events will continue in the conversation review." }]);
      });

      vapi.on("message", (message: Record<string, unknown>) => {
        if (message.type !== "transcript" || typeof message.transcript !== "string") return;
        const role = message.role === "user" ? "customer" : "agent";
        setTranscript((previous) => [...previous, { role, text: message.transcript as string }]);
      });

      vapi.on("error", (event: unknown) => {
        console.error("VAPI error:", event);
        setError("The voice provider returned an error. The action boundary remains fail-closed.");
        setStatus("idle");
      });

      await vapi.start(assistantId, {
        metadata: {
          trustLevel,
          sentiment: sentimentOverride ?? "neutral",
        },
      });
    } catch (event) {
      console.error("Failed to start VAPI call:", event);
      setError(event instanceof Error ? event.message : "Unable to start the voice channel.");
      setStatus("idle");
    }
  }, [sentimentOverride, trustLevel]);

  const endCall = useCallback(() => {
    const vapi = vapiRef.current as { stop?: () => void } | null;
    vapi?.stop?.();
    setStatus("ended");
  }, []);

  const statusLabel = status === "idle" ? "Ready to connect" : status === "connecting" ? "Connecting to VAPI" : status === "active" ? "Live conversation" : "Call complete";

  return (
    <section className="voice-hero">
      <div className="voice-hero-content">
        <div className="eyebrow">Web voice channel / VAPI</div>
        <h2 className="voice-title">A support agent that knows when to stop.</h2>
        <p className="voice-copy">Speak naturally. ShieldDesk can look up orders and resolve low-risk requests, while high-impact actions stay visible and reviewable.</p>

        <div className={`voice-status ${status === "active" ? "active" : ""}`}>
          <span className="status-dot" />
          {statusLabel}
        </div>

        <div className="voice-controls">
          {(status === "idle" || status === "ended") && (
            <button className="button button-primary" onClick={startCall} type="button">
              <Phone size={15} />
              {status === "ended" ? "Start another call" : "Start secure call"}
            </button>
          )}
          {status === "connecting" && (
            <button className="button button-ghost" disabled type="button">
              <LoaderCircle className="spin" size={15} />
              Connecting…
            </button>
          )}
          {status === "active" && (
            <button className="button button-danger" onClick={endCall} type="button">
              <PhoneOff size={15} />
              End call
            </button>
          )}
        </div>

        <div className="voice-metadata">
          <span className="badge"><ShieldCheck size={12} /> Governed</span>
          <span className="badge">{demoContext ? "Requested trust" : "Trust"} {trustLevel} · {TRUST_LABELS[trustLevel]}</span>
          <span className="badge">Sentiment · {liveSentiment}</span>
        </div>

        {error && (
          <div className="data-notice" style={{ marginTop: 20 }}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {transcript.length > 0 && (
          <div className="transcript-live" aria-live="polite">
            {transcript.map((line, index) => (
              <div className="transcript-live-line" key={`${line.role}-${index}`}>
                <strong>{line.role}</strong> {line.text}
              </div>
            ))}
          </div>
        )}
        {transcript.length === 0 && status === "idle" && (
          <div className="voice-empty-hint"><Mic size={14} /> Microphone access is requested only when you start a call.</div>
        )}
      </div>
    </section>
  );
}
