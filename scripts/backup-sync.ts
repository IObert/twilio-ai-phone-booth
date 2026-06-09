/**
 * Backup Twilio Sync data to local files
 * Run this weekly to prevent data loss after 365-day TTL
 *
 * Usage: node --esm backup-sync.ts
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
const backupDir = join(process.cwd(), "backups");

async function backup() {
  console.log("🔄 Starting Sync backup...\n");

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    console.log(`📁 Created backup directory: ${backupDir}\n`);
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // Backup orders from callTracker map
    console.log("📦 Backing up orders...");
    const items = await client.sync.v1
      .services(syncServiceSid)
      .syncMaps('callTracker')
      .syncMapItems.list({ limit: 1000 });

    const orders = items
      .map(item => ({
        callSid: item.key,
        order: item.data.order,
        timestamp: item.data.order?.timestamp,
        status: item.data.status
      }))
      .filter(item => item.order);

    const ordersFile = join(backupDir, `orders-${timestamp}.json`);
    writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
    console.log(`   ✅ Saved ${orders.length} orders to: ${ordersFile}`);

    // Backup inventory document
    console.log("\n📋 Backing up inventory...");
    const inventoryDoc = await client.sync.v1
      .services(syncServiceSid)
      .documents('inventory')
      .fetch();

    const inventoryFile = join(backupDir, `inventory-${timestamp}.json`);
    writeFileSync(inventoryFile, JSON.stringify(inventoryDoc.data, null, 2));
    console.log(`   ✅ Saved inventory to: ${inventoryFile}`);

    // Backup order counter
    console.log("\n🔢 Backing up order counter...");
    try {
      const counterDoc = await client.sync.v1
        .services(syncServiceSid)
        .documents('orderCounter')
        .fetch();

      const counterFile = join(backupDir, `order-counter-${timestamp}.json`);
      writeFileSync(counterFile, JSON.stringify(counterDoc.data, null, 2));
      console.log(`   ✅ Saved counter to: ${counterFile}`);
    } catch (err: any) {
      if (err.status === 404) {
        console.log(`   ⚠️  Order counter not found (will be created on first order)`);
      } else {
        throw err;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("✨ Backup complete!");
    console.log("=".repeat(50));
    console.log(`📊 Orders backed up: ${orders.length}`);
    console.log(`📁 Backup location: ${backupDir}`);
    console.log(`📅 Timestamp: ${timestamp}`);
    console.log("");

  } catch (err) {
    console.error("\n❌ Backup failed:", err);
    process.exit(1);
  }
}

backup();
