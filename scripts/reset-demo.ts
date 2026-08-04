/**
 * Clear local/demo support state and reseed the deterministic demo records.
 *
 * Usage:
 *   npm run reset-demo
 *
 * Set the same DEMO_RESET_TOKEN in the local .env and the Convex deployment.
 * This command refuses APP_ENV=production and never deletes knowledge documents.
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, "../.env") });

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? "development";
  if (appEnv === "production") {
    throw new Error("Demo reset is disabled when APP_ENV=production");
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL environment variable");

  const resetToken = process.env.DEMO_RESET_TOKEN;
  if (!resetToken) throw new Error("Missing DEMO_RESET_TOKEN environment variable");

  const convex = new ConvexHttpClient(convexUrl);
  const report = await convex.mutation(anyApi.demo.reset, { resetToken });
  console.log("ShieldDesk AI — Demo Reset");
  console.log("=========================");
  console.log(JSON.stringify(report, null, 2));

  const { seedDemoData } = await import("./seed-data.js");
  await seedDemoData();
}

main().catch((err) => {
  console.error(`Demo reset failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
