/**
 * scripts/seed-data.ts
 *
 * Seeds the Convex database with demo customers, orders, and knowledge documents.
 * Run after Convex dev server is up.
 *
 * Usage:
 *   npx tsx scripts/seed-data.ts
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dotenvDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dotenvDir, "../.env") });

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

// ── Config ──

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("Missing CONVEX_URL environment variable");
  process.exit(1);
}

const api = anyApi;
const convex = new ConvexHttpClient(CONVEX_URL);

// ── Demo data ──

const CUSTOMERS = [
  {
    externalId: "cust_anon_01",
    name: "Anonymous Visitor",
    email: "anon@example.com",
    phone: "+15551000001",
    tier: "free" as const,
    trustLevel: 1,
  },
  {
    externalId: "cust_auth_01",
    name: "Alice Johnson",
    email: "alice@example.com",
    phone: "+15551000002",
    tier: "pro" as const,
    trustLevel: 2,
  },
  {
    externalId: "cust_premium_01",
    name: "Bob Smith",
    email: "bob@premium.com",
    phone: "+15551000003",
    tier: "pro" as const,
    trustLevel: 3,
  },
  {
    externalId: "cust_vip_01",
    name: "Carol Williams",
    email: "carol@vip.com",
    phone: "+15551000004",
    tier: "enterprise" as const,
    trustLevel: 4,
  },
];

const ORDERS = [
  {
    orderNumber: "ORD-1234",
    customerId: "cust_auth_01",
    status: "delivered" as const,
    items: [
      { productName: "Wireless Headphones", quantity: 1, unitPrice: 79.99 },
    ],
    totalAmount: 79.99,
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
  },
  {
    orderNumber: "ORD-5678",
    customerId: "cust_vip_01",
    status: "delivered" as const,
    items: [
      { productName: "Laptop Pro 15\"", quantity: 1, unitPrice: 1299.00 },
      { productName: "USB-C Hub", quantity: 1, unitPrice: 49.99 },
    ],
    totalAmount: 1348.99,
    createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
  },
  {
    orderNumber: "ORD-9999",
    customerId: "cust_auth_01",
    status: "shipped" as const,
    items: [
      { productName: "Mechanical Keyboard", quantity: 1, unitPrice: 149.99 },
    ],
    totalAmount: 149.99,
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
  },
  {
    orderNumber: "ORD-4567",
    customerId: "cust_premium_01",
    status: "processing" as const,
    items: [
      { productName: "Monitor 27\"", quantity: 2, unitPrice: 399.99 },
    ],
    totalAmount: 799.98,
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
  },
  {
    orderNumber: "ORD-1111",
    customerId: "cust_vip_01",
    status: "processing" as const,
    items: [
      { productName: "Standing Desk", quantity: 1, unitPrice: 599.00 },
      { productName: "Desk Mat XL", quantity: 1, unitPrice: 29.99 },
    ],
    totalAmount: 628.99,
    createdAt: Date.now() - 6 * 60 * 60 * 1000, // 6 hours ago
  },
];

const KNOWLEDGE_DOCS = [
  {
    title: "Return Policy",
    url: "https://shielddesk.example.com/help/returns",
    category: "policy",
    content:
      "Our return policy allows returns within 30 days of delivery for most items. " +
      "Electronics must be returned within 15 days and in original packaging. " +
      "Refunds are processed within 5-7 business days after we receive the returned item. " +
      "Shipping costs for returns are covered for defective items. " +
      "For non-defective returns, a $9.99 return shipping fee applies.",
    contentHash: "return-policy-v1",
  },
  {
    title: "Shipping Information",
    url: "https://shielddesk.example.com/help/shipping",
    category: "shipping",
    content:
      "Standard shipping takes 5-7 business days. Express shipping takes 2-3 business days. " +
      "Free shipping on orders over $50. All orders include tracking. " +
      "International shipping is available to select countries with delivery in 10-15 business days. " +
      "Shipping delays may occur during peak seasons (November-December).",
    contentHash: "shipping-info-v1",
  },
  {
    title: "Account Management FAQ",
    url: "https://shielddesk.example.com/help/account",
    category: "account",
    content:
      "You can update your email, phone, and shipping address from your account settings. " +
      "Password changes require email verification. " +
      "Account deletion is permanent and requires manager approval for VIP accounts. " +
      "Two-factor authentication is available and recommended for all accounts. " +
      "Premium and Enterprise accounts have priority support access.",
    contentHash: "account-faq-v1",
  },
];

// ── Seed functions ──

async function seedCustomers(): Promise<void> {
  console.log("Seeding customers...");
  for (const customer of CUSTOMERS) {
    try {
      await convex.mutation(api.customers.create, customer);
      console.log(`  Created: ${customer.name} (${customer.externalId})`);
    } catch (err: any) {
      console.log(`  Skipped: ${customer.name} — ${err.message ?? err}`);
    }
  }
}

async function seedOrders(): Promise<void> {
  console.log("Seeding orders...");
  for (const order of ORDERS) {
    try {
      await convex.mutation(api.orders.create, order);
      console.log(`  Created: ${order.orderNumber} ($${order.totalAmount})`);
    } catch (err: any) {
      console.log(`  Skipped: ${order.orderNumber} — ${err.message ?? err}`);
    }
  }
}

async function seedKnowledge(): Promise<void> {
  console.log("Seeding knowledge documents...");
  for (const doc of KNOWLEDGE_DOCS) {
    try {
      await convex.mutation(api.knowledgeDocuments.insert, doc);
      console.log(`  Created: ${doc.title}`);
    } catch (err: any) {
      console.log(`  Skipped: ${doc.title} — ${err.message ?? err}`);
    }
  }
}

// ── Main ──

async function main(): Promise<void> {
  console.log("ShieldDesk AI — Seed Data");
  console.log("=========================\n");

  await seedCustomers();
  console.log();
  await seedOrders();
  console.log();
  await seedKnowledge();

  console.log("\n=========================");
  console.log("Seeding complete!");
  console.log(
    `  ${CUSTOMERS.length} customers, ${ORDERS.length} orders, ${KNOWLEDGE_DOCS.length} knowledge docs`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
