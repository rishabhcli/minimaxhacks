import pino from "pino";
import { z } from "zod";
import { config } from "../config.js";
import { SentimentSchema, type Sentiment } from "@shielddesk/shared";

const log = pino({ name: "sentiment-analyzer" });

// ── Per-call sentiment cache ──
const sentimentCache = new Map<string, Sentiment>();

export function getSentiment(callId: string): Sentiment {
  return sentimentCache.get(callId) ?? "neutral";
}

export function setSentiment(callId: string, sentiment: Sentiment): void {
  sentimentCache.set(callId, sentiment);
}

export function clearSentiment(callId: string): void {
  sentimentCache.delete(callId);
}

// ── Sentiment classification via MiniMax ──

const CLASSIFICATION_PROMPT = `Classify the customer's emotional tone in one word: frustrated, neutral, satisfied, or calm.
Message: "{message}"
Reply with ONLY the sentiment word.`;

const SentimentResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    })
  ),
});

/**
 * Analyze sentiment of a user message via a lightweight MiniMax call.
 * Returns the detected sentiment, or "neutral" on any failure.
 */
export async function analyzeSentiment(message: string): Promise<Sentiment> {
  try {
    const response = await fetch(
      `${config.MINIMAX_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.MINIMAX_MODEL,
          messages: [
            {
              role: "user",
              content: CLASSIFICATION_PROMPT.replace("{message}", message),
            },
          ],
          max_tokens: 5,
          temperature: 0,
          stream: false,
        }),
      }
    );

    if (!response.ok) {
      log.warn({ status: response.status }, "Sentiment API call failed");
      return "neutral";
    }

    const data = SentimentResponseSchema.safeParse(await response.json());
    if (!data.success) {
      log.warn("Sentiment response parse failed");
      return "neutral";
    }

    const raw = data.data.choices[0]?.message.content.trim().toLowerCase();
    const parsed = SentimentSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ raw }, "Unexpected sentiment value, defaulting to neutral");
      return "neutral";
    }

    log.info({ sentiment: parsed.data, messagePreview: message.slice(0, 60) }, "Sentiment detected");
    return parsed.data;
  } catch (err) {
    log.warn({ err }, "Sentiment analysis error, defaulting to neutral");
    return "neutral";
  }
}
