"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/api";

type CallStatus = "idle" | "connecting" | "active" | "ended";

function formatVapiError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(
        err,
        (_key, value) => {
          if (value && typeof value === "object") {
            if (seen.has(value)) {
              return "[Circular]";
            }
            seen.add(value);
          }
          return value;
        },
        2
      );
    } catch {
      return "[unserializable error object]";
    }
  }
  return String(err);
}

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
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const upsertConversation = useMutation(api.conversations.upsertBySession);
  const finalizeConversation = useMutation(api.conversations.finalizeBySession);
  const addTranscript = useMutation(api.transcripts.add);

  const ensureMicReady = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (!window.isSecureContext) {
      setTranscript([
        "Microphone access requires a secure context. Open this on https:// or localhost.",
      ]);
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setTranscript([
        "This browser does not support microphone capture via getUserMedia.",
      ]);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTranscript([
        `Microphone permission is required to start a call. Browser error: ${message}`,
      ]);
      return false;
    }
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [transcript]);

  useEffect(() => {
    return () => {
      const vapi = vapiRef.current as { end?: () => void; stop?: () => void } | null;
      if (vapi?.end) {
        vapi.end();
      } else {
        vapi?.stop?.();
      }
      vapiRef.current = null;
      callIdRef.current = null;
      conversationIdRef.current = null;
    };
  }, []);

  const ensureConversationRecord = useCallback(
    async (callId: string | null) => {
      if (!callId) return null;
      if (conversationIdRef.current) return conversationIdRef.current;
      try {
        const convId = (await upsertConversation({
          channelType: "vapi_web",
          channelSessionId: callId,
          trustLevel: 2,
          sentimentScore: "neutral",
          startedAt: Date.now(),
        })) as string;
        conversationIdRef.current = convId;
        return convId;
      } catch {
        return null;
      }
    },
    [upsertConversation]
  );

  const startCall = useCallback(async () => {
    try {
      setStatus("connecting");
      setTranscript([]);
      callIdRef.current = null;

      const micReady = await ensureMicReady();
      if (!micReady) {
        setStatus("idle");
        return;
      }

      const existing = vapiRef.current as { end?: () => void; stop?: () => void } | null;
      if (existing?.end) {
        existing.end();
      } else {
        existing?.stop?.();
      }
      vapiRef.current = null;

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

      vapi.on("call-start-success", async (event: { callId?: string }) => {
        if (typeof event?.callId === "string" && event.callId.length > 0) {
          callIdRef.current = event.callId;
          await ensureConversationRecord(event.callId);
        }
      });

      vapi.on("call-end", async () => {
        setStatus("ended");
        setTranscript((prev) => [...prev, "[Call ended]"]);
        if (callIdRef.current) {
          try {
            await finalizeConversation({
              channelSessionId: callIdRef.current,
              status: "completed",
              endedAt: Date.now(),
            });
          } catch {
            // non-blocking
          }
        }
        vapiRef.current = null;
        callIdRef.current = null;
      });

      vapi.on("speech-start", () => {
        setTranscript((prev) => [...prev, "[Agent speaking...]"]);
      });

      vapi.on("speech-end", () => {
        // Agent finished speaking
      });

      vapi.on("message", async (msg: Record<string, unknown>) => {
        if (msg.type === "transcript" && typeof msg.transcript === "string") {
          const role = msg.role === "user" ? "You" : "Agent";
          setTranscript((prev) => [...prev, `${role}: ${msg.transcript}`]);
          const convId =
            conversationIdRef.current ||
            (await ensureConversationRecord(callIdRef.current));
          if (convId) {
            addTranscript({
              conversationId: convId as any,
              speaker: role === "You" ? "customer" : "agent",
              isFinal: true,
              text: msg.transcript,
            }).catch(() => undefined);
          }
        }
      });

      vapi.on("error", (err: unknown) => {
        console.error("VAPI error:", err);
        const errMsg = formatVapiError(err);
        setTranscript((prev) => [...prev, `[Error: ${errMsg}]`]);
        setStatus("idle");
        vapiRef.current = null;
      });

      const started = await vapi.start(assistantId, {
        metadata: {
          trustLevel: 2,
          sentiment: "neutral",
          confidence: 0.9,
        },
      });
      if (started && typeof started === "object" && "id" in started) {
        const cid = (started as { id?: unknown }).id;
        if (typeof cid === "string" && cid.length > 0) {
          callIdRef.current = cid;
          await ensureConversationRecord(cid);
        }
      }
    } catch (err) {
      console.error("Failed to start VAPI call:", err);
      setTranscript((prev) => [
        ...prev,
        `[Failed to start: ${err instanceof Error ? err.message : String(err)}]`,
      ]);
      setStatus("idle");
      vapiRef.current = null;
    }
  }, [ensureMicReady]);

  const endCall = useCallback(() => {
    const vapi = vapiRef.current as { end?: () => void; stop?: () => void } | null;
    if (vapi?.end) {
      vapi.end();
    } else {
      vapi?.stop?.();
    }
    setStatus("ended");
    setTranscript((prev) => [...prev, "[Call manually ended]"]);
    if (callIdRef.current) {
      finalizeConversation({
        channelSessionId: callIdRef.current,
        status: "completed",
        endedAt: Date.now(),
      }).catch(() => undefined);
    }
    vapiRef.current = null;
    callIdRef.current = null;
  }, []);

  return (
    <div className="card widget-shell">
      <div className="section-title">
        <span>Voice Support</span>
        <span className="section-caption">WebRTC / VAPI</span>
      </div>

      <p className="summary-text">
        Start a live support call. The agent is governed by policy controls and tool-call approvals.
      </p>

      <div className="widget-controls">
        {status === "idle" && (
          <button onClick={startCall} className="btn btn-primary">
            Talk to Support
          </button>
        )}
        {status === "connecting" && (
          <button disabled className="btn btn-outline">
            Connecting...
          </button>
        )}
        {status === "active" && (
          <button onClick={endCall} className="btn btn-danger">
            End Call
          </button>
        )}
        {status === "ended" && (
          <button onClick={startCall} className="btn btn-primary">
            Start New Call
          </button>
        )}
      </div>

      <div className="widget-status">
        {status === "active" && <span className="dot-live" aria-hidden="true" />}
        Status:
        <span className={`badge ${status === "active" ? "badge-active" : "badge-completed"}`}>
          {status}
        </span>
      </div>

      {transcript.length > 0 && (
        <div className="transcript-log" ref={transcriptRef}>
          {transcript.map((line, i) => (
            <div key={`${line}-${i}`} className="log-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
