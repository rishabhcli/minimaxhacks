const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_VAPI_PUBLIC_KEY: process.env.VAPI_PUBLIC_KEY,
    NEXT_PUBLIC_VAPI_ASSISTANT_ID: process.env.VAPI_ASSISTANT_ID,
  },
};
module.exports = nextConfig;
