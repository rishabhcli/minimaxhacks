import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load root .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

const EnvSchema = z.object({
  MCP_PORT: z.coerce.number().default(3001),
  MCP_AUTH_TOKEN: z.string().min(1),
  CONVEX_URL: z.string().url(),
  MINIMAX_API_KEY: z.string().min(1),
  MINIMAX_BASE_URL: z.string().url().default("https://api.minimax.io/v1"),
});

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("MCP Server config validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
