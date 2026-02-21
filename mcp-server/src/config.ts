import { z } from "zod";

const EnvSchema = z.object({
  MCP_PORT: z.coerce.number().default(3001),
  CONVEX_URL: z.string().url(),
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
