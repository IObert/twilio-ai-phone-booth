/**
 * Test Inventory Validation
 *
 * Simulates various order scenarios to verify validation logic
 *
 * Usage: npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert";
import { config } from "dotenv";
import twilio from "twilio";

config();

const client = twilio(
  process.env.TWILIO_API_KEY,
  process.env.TWILIO_API_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
const BASE_URL = process.env.NGROK_BASE_URL || "http://localhost:8000";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getInventory() {
  const doc = await client.sync.v1
    .services(syncServiceSid)
    .documents("inventory")
    .fetch();
  return doc.data;
}

async function createTestCallSid(): Promise<string> {
  const testCallSid = `CA_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await client.sync.v1
    .services(syncServiceSid)
    .syncMaps("callTracker")
    .syncMapItems.create({
      key: testCallSid,
      ttl: 300,
      data: {
        status: "in-progress",
        tasks: {
          swag_order_placed: false,
          swag_question_asked: false,
          twilio_question_asked: false,
        },
        history: [],
      },
    });

  return testCallSid;
}

async function submitOrder(callSid: string, item: string, size: string) {
  const response = await fetch(`${BASE_URL}/api/beans/swagOrder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-call-sid": callSid,
    },
    body: JSON.stringify({ item, size }),
  });

  return response.json();
}

async function cleanupTestCall(callSid: string) {
  try {
    await client.sync.v1
      .services(syncServiceSid)
      .syncMaps("callTracker")
      .syncMapItems(callSid)
      .remove();
  } catch (err) {
    // Ignore cleanup errors
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Inventory Validation", () => {
  let inventory: any;
  let enabledNoSizeItem: string | null = null;

  before(async () => {
    console.log(`\n🔗 Testing against: ${BASE_URL}\n`);
    inventory = await getInventory();

    console.log("📦 Current Inventory:");
    const items = (inventory as any).items || [];
    items.forEach((item: any) => {
      const status = item.enabled ? "✅" : "❌";
      const sizes = item.hasSize && item.sizes ? ` (${item.sizes.join(", ")})` : "";
      console.log(`  ${status} ${item.name}${sizes}`);

      // Find an enabled item without sizes for testing
      if (item.enabled && !item.hasSize && !enabledNoSizeItem) {
        enabledNoSizeItem = item.name;
      }
    });
    console.log("");

    if (!enabledNoSizeItem) {
      throw new Error("No enabled non-sized items found in inventory. Please enable at least one item without sizes.");
    }
  });

  test("Valid order - T-Shirt with valid size", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, "T-Shirt", "L");
      assert.ok(result.orderNumber, "Should return order number");
      assert.ok(!result.error, "Should not have error");
    } finally {
      await cleanupTestCall(callSid);
    }
  });

  test("Invalid size - T-Shirt with non-existent size", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, "T-Shirt", "Small");
      assert.ok(result.error, "Should return error");
      assert.match(result.error, /Invalid size/, "Error should mention invalid size");
    } finally {
      await cleanupTestCall(callSid);
    }
  });

  test("Missing size - T-Shirt without size", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, "T-Shirt", "");
      assert.ok(result.error, "Should return error");
      assert.match(result.error, /Size is required/, "Error should mention size required");
    } finally {
      await cleanupTestCall(callSid);
    }
  });

  test("Valid order - non-sized item (no size required)", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, enabledNoSizeItem!, "");
      assert.ok(result.orderNumber, `Should return order number for ${enabledNoSizeItem}`);
      assert.ok(!result.error, "Should not have error");
    } finally {
      await cleanupTestCall(callSid);
    }
  });

  test("Non-existent item", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, "Blue Hoodie", "");
      assert.ok(result.error, "Should return error");
      assert.match(result.error, /not available/, "Error should mention not available");
    } finally {
      await cleanupTestCall(callSid);
    }
  });

  test("Case insensitive - t-shirt (lowercase)", async () => {
    const callSid = await createTestCallSid();
    try {
      const result = await submitOrder(callSid, "t-shirt", "l");
      assert.ok(result.orderNumber, "Should return order number");
      assert.ok(!result.error, "Should not have error");
    } finally {
      await cleanupTestCall(callSid);
    }
  });
});
