import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load root .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  CONVEX_URL: z.string().url(),
  MINIMAX_API_KEY: z.string().min(1),
  MINIMAX_BASE_URL: z.string().url().default("https://api.minimax.io/v1"),
  MINIMAX_MODEL: z.string().default("MiniMax-M2.5"),
  MCP_SERVER_URL: z.string().url().default("http://localhost:3001/mcp"),
  ARMORIQ_API_KEY: z.string().default(""),
  ARMORIQ_USER_ID: z.string().default(""),
  ARMORIQ_AGENT_ID: z.string().default(""),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  // Plivo
  PLIVO_AUTH_ID: z.string().default(""),
  PLIVO_AUTH_TOKEN: z.string().default(""),
  PLIVO_PHONE_NUMBER: z.string().default(""),
  // Speechmatics
  SPEECHMATICS_API_KEY: z.string().default(""),
  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID: z.string().default(""),
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
