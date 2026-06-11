import "dotenv/config";
import twilio from "twilio";
import { SYNC_MAP_NAME } from "../sync.ts";

const client = twilio(
  process.env.TWILIO_API_KEY!,
  process.env.TWILIO_API_SECRET!,
  { accountSid: process.env.TWILIO_ACCOUNT_SID! }
);

const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

const items = await client.sync.v1
  .services(syncServiceSid)
  .syncMaps(SYNC_MAP_NAME)
  .syncMapItems.list({ limit: 1000 });

if (items.length === 0) {
  console.log("No items to delete.");
  process.exit(0);
}

console.log(`Deleting ${items.length} item(s) from '${SYNC_MAP_NAME}'...`);

await Promise.all(
  items.map((item) =>
    client.sync.v1
      .services(syncServiceSid)
      .syncMaps(SYNC_MAP_NAME)
      .syncMapItems(item.key)
      .remove()
  )
);

console.log("Done. Stats have been reset.");
