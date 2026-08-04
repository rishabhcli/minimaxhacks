import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load root .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  CONVEX_URL: z.string().url(),
  MINIMAX_API_KEY: z.string().min(1),
  MINIMAX_BASE_URL: z.string().url().default("https://api.minimax.io/v1"),
  MINIMAX_MODEL: z.string().default("MiniMax-M2.5"),
  MCP_SERVER_URL: z.string().url().default("http://localhost:3001/mcp"),
  MCP_AUTH_TOKEN: z.string().min(1),
  VAPI_WEBHOOK_SECRET: z.string().default(""),
  ARMORIQ_API_KEY: z.string().default(""),
  ARMORIQ_USER_ID: z.string().default(""),
  ARMORIQ_AGENT_ID: z.string().default(""),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  CORS_ALLOW_ORIGINS: z
    .string()
    .default("http://localhost:3002")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  ALLOW_CLIENT_GOVERNANCE_OVERRIDES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  // Plivo
  PLIVO_AUTH_ID: z.string().default(""),
  PLIVO_AUTH_TOKEN: z.string().default(""),
  PLIVO_PHONE_NUMBER: z.string().default(""),
  // Speechmatics
  SPEECHMATICS_API_KEY: z.string().default(""),
  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID: z.string().default(""),
}).superRefine((env, ctx) => {
  if (env.APP_ENV !== "production") return;

  if (!env.VAPI_WEBHOOK_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["VAPI_WEBHOOK_SECRET"], message: "is required in production" });
  }
  if (!env.PUBLIC_URL.startsWith("https://")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_URL"], message: "must use https:// in production" });
  }
  if (env.CORS_ALLOW_ORIGINS.some((origin) => /(^|localhost|127\.0\.0\.1)/i.test(origin))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ALLOW_ORIGINS"], message: "must not include local development origins in production" });
  }
  if (env.ALLOW_CLIENT_GOVERNANCE_OVERRIDES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ALLOW_CLIENT_GOVERNANCE_OVERRIDES"], message: "must remain false in production" });
  }
});

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("API Server config validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
