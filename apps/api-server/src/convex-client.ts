import { ConvexHttpClient } from "convex/browser";
import { config } from "./config.js";

export const convex = new ConvexHttpClient(config.CONVEX_URL);
