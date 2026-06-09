import twilio from "twilio";

export interface CintelSummary {
  sentiment?: string;
  summary?: string;
}

export interface SwagOrder {
  item: string;
  size?: string;
  timestamp: string;
  orderNumber?: string | number;
  status?: "pending" | "completed" | "cancelled";
}

export interface CallTrackerItem {
  status: "calling" | "in-progress" | "completed" | "failed";
  tasks: { swag_order_placed: boolean; swag_question_asked: boolean; twilio_question_asked: boolean };
  history: { role: "user" | "ai"; text: string }[];
  duration?: number;
  viSid?: string;
  cintel?: CintelSummary;
  observations?: string[];
  summaries?: string[];
  order?: SwagOrder;
}

export const SYNC_MAP_NAME = "callTracker";
export const SYNC_ITEM_TTL = 31536000; // 365 days (max allowed)
export const INVENTORY_DOC_NAME = "inventory";
export const ORDER_COUNTER_DOC_NAME = "orderCounter";

function getTwilio() {
  return twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, { accountSid: process.env.TWILIO_ACCOUNT_SID! });
}

export function getSyncItem(callSid: string) {
  return getTwilio().sync.v1
    .services(process.env.TWILIO_SYNC_SERVICE_SID!)
    .syncMaps(SYNC_MAP_NAME)
    .syncMapItems(callSid);
}

export async function updateCallTracker(callSid: string, patch: Partial<CallTrackerItem>, attempt = 0): Promise<void> {
  try {
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await getSyncItem(callSid).update({
      data: { ...current, ...patch },
      ttl: SYNC_ITEM_TTL,
    });
  } catch (err: any) {
    // Sync item not yet created — race between callStatus webhook and Sync write.
    if (err?.status === 404 && attempt < 5) {
      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
      return updateCallTracker(callSid, patch, attempt + 1);
    }
    console.error(`[sync] updateCallTracker error (${callSid}):`, err);
  }
}

/**
 * Get or create Sync Document for inventory
 */
export async function getInventoryDoc() {
  const client = getTwilio();
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

  try {
    return await client.sync.v1
      .services(syncServiceSid)
      .documents(INVENTORY_DOC_NAME)
      .fetch();
  } catch (err: any) {
    if (err?.status === 404) {
      // Create if doesn't exist
      return await client.sync.v1
        .services(syncServiceSid)
        .documents.create({
          uniqueName: INVENTORY_DOC_NAME,
          data: getDefaultInventory(),
          ttl: SYNC_ITEM_TTL
        });
    }
    throw err;
  }
}

/**
 * Get default inventory structure
 */
export function getDefaultInventory() {
  return {
    items: [
      { name: "Notebook", enabled: false, hasSize: false, stock: 0 },
      { name: "Pen", enabled: false, hasSize: false, stock: 0 },
      { name: "Sling Bag", enabled: false, hasSize: false, stock: 0 },
      { name: "Socks", enabled: false, hasSize: false, stock: 0 },
      { name: "Tic Tac Toe", enabled: false, hasSize: false, stock: 0 },
      { name: "Phone Strap", enabled: false, hasSize: false, stock: 0 },
      { name: "Cable Tidy", enabled: false, hasSize: false, stock: 0 },
      {
        name: "T-Shirt",
        enabled: false,
        hasSize: true,
        sizes: ["2XL", "XL", "L", "M", "S"],
        sizeStock: [
          { size: "2XL", stock: 0 },
          { size: "XL", stock: 0 },
          { size: "L", stock: 0 },
          { size: "M", stock: 0 },
          { size: "S", stock: 0 }
        ]
      },
    ],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Update inventory document
 */
export async function updateInventory(inventoryData: any): Promise<void> {
  const client = getTwilio();
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

  await client.sync.v1
    .services(syncServiceSid)
    .documents(INVENTORY_DOC_NAME)
    .update({
      data: {
        ...inventoryData,
        lastUpdated: new Date().toISOString()
      },
      ttl: SYNC_ITEM_TTL
    });
}

/**
 * Get or create order counter document
 */
export async function getOrderCounter(): Promise<number> {
  const client = getTwilio();
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

  try {
    const doc = await client.sync.v1
      .services(syncServiceSid)
      .documents(ORDER_COUNTER_DOC_NAME)
      .fetch();

    return (doc.data as any).nextOrderNumber || 1;
  } catch (err: any) {
    if (err?.status === 404) {
      // Create if doesn't exist
      await client.sync.v1
        .services(syncServiceSid)
        .documents.create({
          uniqueName: ORDER_COUNTER_DOC_NAME,
          data: { nextOrderNumber: 1 },
          ttl: SYNC_ITEM_TTL
        });
      return 1;
    }
    throw err;
  }
}

/**
 * Increment and get next order number
 */
export async function incrementOrderCounter(): Promise<number> {
  const client = getTwilio();
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

  const currentNumber = await getOrderCounter();

  await client.sync.v1
    .services(syncServiceSid)
    .documents(ORDER_COUNTER_DOC_NAME)
    .update({
      data: { nextOrderNumber: currentNumber + 1 },
      ttl: SYNC_ITEM_TTL
    });

  return currentNumber;
}
