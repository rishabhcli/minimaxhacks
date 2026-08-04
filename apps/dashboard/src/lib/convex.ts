"use client";

import { ConvexReactClient } from "convex/react";

export const isConvexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
export const convex = isConvexConfigured
  ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL as string)
  : null;
