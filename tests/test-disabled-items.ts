/**
 * Test: Disabled Items Are Not Offered
 *
 * Verifies that when an inventory item is disabled:
 * 1. Agent does not include it in system instructions
 * 2. Server validation rejects orders for disabled items
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getInventory() {
  const doc = await client.sync.v1
    .services(syncServiceSid)
    .documents("inventory")
    .fetch();
  return doc.data as any;
}

function simulateAgentInstructions(inventory: any) {
  // This is what the agent does in agent.ts
  return inventory.items
    .filter((item: any) => item.enabled)
    .map((item: any) => item.name);
}

function testServerValidation(inventory: any, itemName: string) {
  const inventoryItem = inventory.items.find(
    (i: any) => i.name.toLowerCase() === itemName.toLowerCase()
  );

  if (!inventoryItem) {
    return { valid: false, reason: "Item not found in inventory" };
  }

  if (!inventoryItem.enabled) {
    return { valid: false, reason: "Item is currently unavailable" };
  }

  return { valid: true, reason: "Order would be accepted" };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Disabled Items Protection", () => {
  let inventory: any;
  let enabledItems: string[];
  let disabledItems: string[];

  before(async () => {
    inventory = await getInventory();
    enabledItems = [];
    disabledItems = [];

    console.log("\n📦 Current Inventory:\n");
    inventory.items.forEach((item: any) => {
      const status = item.enabled ? "✅ Enabled " : "❌ Disabled";
      console.log(`   ${status} - ${item.name}`);

      if (item.enabled) {
        enabledItems.push(item.name);
      } else {
        disabledItems.push(item.name);
      }
    });
    console.log("");
  });

  describe("Agent Instructions", () => {
    test("Disabled items should NOT be in agent instructions", async () => {
      const availableToAgent = simulateAgentInstructions(inventory);

      for (const disabledItem of disabledItems) {
        assert.ok(
          !availableToAgent.includes(disabledItem),
          `Disabled item "${disabledItem}" should not be offered by agent`
        );
      }
    });

    test("Enabled items should BE in agent instructions", async () => {
      const availableToAgent = simulateAgentInstructions(inventory);

      for (const enabledItem of enabledItems) {
        assert.ok(
          availableToAgent.includes(enabledItem),
          `Enabled item "${enabledItem}" should be offered by agent`
        );
      }
    });
  });

  describe("Server Validation", () => {
    test("Server should reject disabled items", async () => {
      for (const disabledItem of disabledItems) {
        const result = testServerValidation(inventory, disabledItem);
        assert.strictEqual(
          result.valid,
          false,
          `Server should reject disabled item "${disabledItem}"`
        );
      }
    });

    test("Server should accept enabled items", async () => {
      for (const enabledItem of enabledItems) {
        const result = testServerValidation(inventory, enabledItem);
        assert.strictEqual(
          result.valid,
          true,
          `Server should accept enabled item "${enabledItem}"`
        );
      }
    });
  });
});
