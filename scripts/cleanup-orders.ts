/**
 * Clean up old orders from Twilio Sync
 *
 * Options:
 * - Delete all orders
 * - Delete completed orders only
 * - Delete orders older than X days
 * - Backup before deletion
 *
 * Usage: node --esm cleanup-orders.ts [options]
 */

import { config } from "dotenv";
import twilio from "twilio";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

config();

const client = twilio(
  process.env.TWILIO_API_KEY,
  process.env.TWILIO_API_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const OPTIONS = {
  // Set to true to actually delete (false = dry run)
  ACTUALLY_DELETE: false,

  // What to delete
  DELETE_ALL: false,                    // Delete all orders
  DELETE_COMPLETED_ONLY: false,         // Delete only completed orders
  DELETE_OLDER_THAN_DAYS: 30,          // Delete orders older than X days (0 = disabled)

  // Safety
  BACKUP_BEFORE_DELETE: true,           // Create backup before deleting
};

// ────────────────────────────────────────────────────────────────────────────

async function backupOrders() {
  const backupDir = join(process.cwd(), "backups");

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];

  const items = await client.sync.v1
    .services(syncServiceSid)
    .syncMaps('callTracker')
    .syncMapItems.list({ limit: 1000 });

  const orders = items
    .map(item => ({
      callSid: item.key,
      order: item.data.order,
      status: item.data.status,
      timestamp: item.data.order?.timestamp,
    }))
    .filter(item => item.order);

  const backupFile = join(backupDir, `orders-backup-${timestamp}.json`);
  writeFileSync(backupFile, JSON.stringify(orders, null, 2));

  console.log(`📦 Backed up ${orders.length} orders to: ${backupFile}\n`);
  return orders.length;
}

async function cleanup() {
  console.log("🧹 Order Cleanup Tool\n");
  console.log("Configuration:");
  console.log(`  - Actually delete: ${OPTIONS.ACTUALLY_DELETE ? '✅ YES' : '❌ DRY RUN'}`);
  console.log(`  - Delete all: ${OPTIONS.DELETE_ALL}`);
  console.log(`  - Delete completed only: ${OPTIONS.DELETE_COMPLETED_ONLY}`);
  console.log(`  - Delete older than: ${OPTIONS.DELETE_OLDER_THAN_DAYS} days`);
  console.log(`  - Backup first: ${OPTIONS.BACKUP_BEFORE_DELETE}\n`);

  if (!OPTIONS.ACTUALLY_DELETE) {
    console.log("⚠️  DRY RUN MODE - No items will be deleted\n");
  }

  try {
    // Backup if enabled
    if (OPTIONS.BACKUP_BEFORE_DELETE) {
      await backupOrders();
    }

    // Fetch all items
    console.log("📋 Fetching orders from Sync...");
    const items = await client.sync.v1
      .services(syncServiceSid)
      .syncMaps('callTracker')
      .syncMapItems.list({ limit: 1000 });

    console.log(`   Found ${items.length} total call records\n`);

    // Filter items to delete
    const itemsToDelete = items.filter(item => {
      const data = item.data as any;

      // Must have an order
      if (!data.order) return false;

      // Delete all?
      if (OPTIONS.DELETE_ALL) return true;

      // Delete completed only?
      if (OPTIONS.DELETE_COMPLETED_ONLY && data.order.status !== 'completed') {
        return false;
      }

      // Delete older than X days?
      if (OPTIONS.DELETE_OLDER_THAN_DAYS > 0) {
        const orderDate = new Date(data.order.timestamp);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - OPTIONS.DELETE_OLDER_THAN_DAYS);

        if (orderDate >= cutoffDate) {
          return false;
        }
      }

      return true;
    });

    console.log(`🗑️  Items to delete: ${itemsToDelete.length}\n`);

    if (itemsToDelete.length === 0) {
      console.log("✨ Nothing to delete!");
      return;
    }

    // Show what will be deleted
    console.log("Items that will be deleted:");
    itemsToDelete.slice(0, 10).forEach(item => {
      const data = item.data as any;
      const order = data.order;
      console.log(`  - ${item.key.substring(0, 20)}... | ${order.item} ${order.size || ''} | ${order.status} | ${new Date(order.timestamp).toLocaleDateString()}`);
    });

    if (itemsToDelete.length > 10) {
      console.log(`  ... and ${itemsToDelete.length - 10} more\n`);
    } else {
      console.log("");
    }

    // Actually delete?
    if (OPTIONS.ACTUALLY_DELETE) {
      console.log("🗑️  Deleting items...\n");

      let deleted = 0;
      let failed = 0;

      for (const item of itemsToDelete) {
        try {
          await client.sync.v1
            .services(syncServiceSid)
            .syncMaps('callTracker')
            .syncMapItems(item.key)
            .remove();

          deleted++;

          if (deleted % 10 === 0) {
            console.log(`   Deleted ${deleted}/${itemsToDelete.length}...`);
          }
        } catch (err) {
          console.error(`   ❌ Failed to delete ${item.key}:`, err);
          failed++;
        }
      }

      console.log("\n" + "=".repeat(50));
      console.log("✅ Cleanup complete!");
      console.log("=".repeat(50));
      console.log(`✅ Successfully deleted: ${deleted}`);
      if (failed > 0) {
        console.log(`❌ Failed to delete: ${failed}`);
      }
      console.log("");
    } else {
      console.log("💡 To actually delete, set OPTIONS.ACTUALLY_DELETE = true\n");
    }

  } catch (err) {
    console.error("\n❌ Cleanup failed:", err);
    process.exit(1);
  }
}

cleanup();
