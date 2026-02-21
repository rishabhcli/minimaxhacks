import { anyApi } from "convex/server";

/**
 * Use anyApi to reference Convex functions without requiring codegen.
 * This allows the dashboard to build without running `npx convex dev` first.
 * Type safety is handled at the Convex function level.
 */
export const api = anyApi;
