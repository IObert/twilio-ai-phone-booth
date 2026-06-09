/**
 * Frontend API layer — all routes and WebSockets for the booth display.
 * Imported by server.ts and registered on the shared Fastify instance.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import twilio from "twilio";
import { WELCOME_GREETING, TASKS, UI_CONFIG } from "./config.ts";
import { updateCallTracker, getSyncItem, SYNC_MAP_NAME, SYNC_ITEM_TTL, type CallTrackerItem, type CintelSummary, getInventoryDoc, updateInventory, incrementOrderCounter, getDefaultInventory } from "./sync.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
function serveTemplated(file: string, vars: Record<string, string>): string {
  let html = readFileSync(join(__dirname, "public", file), "utf8");
  for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`%%${k}%%`, v);
  return html;
}

/**
 * Recursively flatten a config object into template variables.
 *
 * Examples:
 *   { brandName: "Store" } → { BRAND_NAME: "Store" }
 *   { hero: { title: "Hi" } } → { HERO_TITLE: "Hi" }
 *   { cards: [{ icon: "🎯" }] } → { CARDS_1_ICON: "🎯" }
 */
function flattenConfig(obj: any, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Convert camelCase to UPPER_SNAKE_CASE
    const snakeCase = key.replace(/([A-Z])/g, "_$1").toUpperCase();
    const varName = prefix ? `${prefix}${snakeCase}` : snakeCase;

    if (typeof value === "string") {
      result[varName] = value;
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "string") {
          result[`${varName}_${i + 1}`] = item;
        } else if (typeof item === "object" && item !== null) {
          Object.assign(result, flattenConfig(item, `${varName}_${i + 1}_`));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, flattenConfig(value, varName + "_"));
    }
  }

  return result;
}

// ─── types ────────────────────────────────────────────────────────────────────

interface OperatorResult {
  operator: { displayName: string };
  outputFormat: "CLASSIFICATION" | "TEXT";
  result: { label?: string; text?: string };
  referenceIds?: string[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getTwilio() {
  return twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, { accountSid: process.env.TWILIO_ACCOUNT_SID! });
}

function getPublicBaseUrl(req: FastifyRequest): string {
  const host = req.headers.host ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.")) {
    return process.env.NGROK_BASE_URL!;
  }
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}`;
}

async function initiateCall(ngrokBase: string): Promise<string> {
  const client = getTwilio();
  const sipAddress = process.env.SIP_PHONE_ADDRESS!;
  const from = process.env.TWILIO_PHONE_NUMBER!;

  const call = await client.calls.create({
    to: sipAddress,
    from,
    url: `${ngrokBase}/tac`,
    statusCallback: `${ngrokBase}/api/callStatus`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });

  return call.sid;
}

async function seedCallTracker(callSid: string): Promise<void> {
  const client = getTwilio();
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

  await client.sync.v1.services(syncServiceSid).syncMaps(SYNC_MAP_NAME)
    .fetch().catch(() =>
      client.sync.v1.services(syncServiceSid).syncMaps.create({ uniqueName: SYNC_MAP_NAME })
    );

  await client.sync.v1.services(syncServiceSid)
    .syncMaps(SYNC_MAP_NAME).syncMapItems.create({
      key: callSid,
      ttl: SYNC_ITEM_TTL,
      data: {
        status: "calling",
        tasks: { swag_order_placed: false, swag_question_asked: false, twilio_question_asked: false },
        history: [{ role: "ai", text: WELCOME_GREETING }],
      } satisfies CallTrackerItem,
    });
}

// ─── template variable builders ──────────────────────────────────────────────

function getStartPageVars(): Record<string, string> {
  return {
    ...flattenConfig(UI_CONFIG),
    ATTRACT_MODE: process.env.ATTRACT_MODE === "true" ? "true" : "false",
    ATTRACT_DEV: process.env.ATTRACT_DEV === "true" ? "true" : "false",
    // Add optional badge HTML for card 3
    CARDS_3_OPTIONAL_BADGE: UI_CONFIG.cards[2]?.optional
      ? '<span class="card-optional-tag">Optional</span>'
      : "",
  };
}

function getCallPageVars(): Record<string, string> {
  return {
    ...flattenConfig(UI_CONFIG),
    // Add task labels from the task keys
    TASK_1_LABEL: UI_CONFIG.taskLabels[TASKS.TWILIO_QUESTION] ?? "",
    TASK_2_LABEL: UI_CONFIG.taskLabels[TASKS.SWAG_QUESTION] ?? "",
    TASK_3_LABEL: UI_CONFIG.taskLabels[TASKS.SWAG_ORDER] ?? "",
  };
}

function getSummaryPageVars(): Record<string, string> {
  return flattenConfig(UI_CONFIG);
}

function getStatsPageVars(): Record<string, string> {
  return flattenConfig(UI_CONFIG);
}

// ─── basic auth ───────────────────────────────────────────────────────────────

function requireBasicAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const [user, pass] = decoded.split(":");
    const expectedUser = process.env.STATS_USER!;
    const expectedPass = process.env.STATS_PASS!;
    if (user === expectedUser && pass === expectedPass) return true;
  }
  reply
    .code(401)
    .header("WWW-Authenticate", 'Basic realm="Twilio Cafe Stats"')
    .send("Unauthorized");
  return false;
}

// ─── plugin ───────────────────────────────────────────────────────────────────

export async function registerFrontendRoutes(app: FastifyInstance): Promise<void> {

  // ── Clean HTML routes ─────────────────────────────────────────────────────
  app.get("/", (_, reply) => reply.redirect("/start"));
  app.get("/start", (_, reply) => {
    const html = serveTemplated("start.html", getStartPageVars());
    reply.type("text/html").send(html);
  });
  app.get("/call", (_, reply) => {
    const html = serveTemplated("call.html", getCallPageVars());
    reply.type("text/html").send(html);
  });
  app.get("/summary", (_, reply) => {
    const html = serveTemplated("summary.html", getSummaryPageVars());
    reply.type("text/html").send(html);
  });

  // ── POST /intelligence-results (Conversation Intelligence results) ─────────────
  app.post("/intelligence-results", async (req) => {
    const body = req.body as { operatorResults?: OperatorResult[] } ?? {};
    if (!body.operatorResults?.length) return { ok: true };

    const cintel: CintelSummary = {};
    for (const r of body.operatorResults) {
      const name = r.operator?.displayName;
      if (name === "Sentiment") cintel.sentiment = r.result.label;
      if (name === "Summary")   cintel.summary   = r.result.text;
      // TODO: add handling for additional operators here (e.g. topics, entities)
    }

    const callSids = [...new Set(
      body.operatorResults.flatMap((r) => r.referenceIds ?? [])
    )];

    await Promise.all(callSids.map((callSid) => updateCallTracker(callSid, { cintel })));
    return { ok: true };
  });

  // ── POST /api/startBoothCall ───────────────────────────────────────────────
  app.post("/api/startBoothCall", async (req, reply) => {
    const ngrokBase = getPublicBaseUrl(req);

    try {
      const callSid = await initiateCall(ngrokBase);
      await seedCallTracker(callSid);
      return { success: true, callSid };
    } catch (err) {
      console.error("[startBoothCall] Error:", err);
      return reply.code(500).send({ success: false, error: String(err) });
    }
  });

  // ── POST /api/getSyncToken ─────────────────────────────────────────────────
  app.post("/api/getSyncToken", async () => {
    const AccessToken = twilio.jwt.AccessToken;
    const SyncGrant = AccessToken.SyncGrant;
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_API_KEY!,
      process.env.TWILIO_API_SECRET!,
      { identity: "booth-display", ttl: 3600 },
    );
    const grant = new SyncGrant({ serviceSid: process.env.TWILIO_SYNC_SERVICE_SID! });
    token.addGrant(grant);
    return { token: token.toJwt() };
  });

  // ── POST /api/callStatus (Twilio call status callback) ───────────────────
  app.post("/api/callStatus", async (req) => {
    const body = req.body as Record<string, string> ?? {};
    const callSid = body.CallSid;
    const callStatus = body.CallStatus;

    if (!callSid || !callStatus) return { ok: true };

    const statusMap: Record<string, CallTrackerItem["status"]> = {
      initiated:     "calling",
      ringing:       "calling",
      "in-progress": "in-progress",
      answered:      "in-progress",
      completed:     "completed",
      failed:        "failed",
      busy:          "failed",
      "no-answer":   "failed",
    };

    const syncStatus = statusMap[callStatus];
    if (syncStatus) {
      const patch: Partial<CallTrackerItem> = { status: syncStatus };
      if (callStatus === "completed") {
        const raw = body.CallDuration ?? body.Duration ?? "";
        const secs = parseInt(raw, 10);
        if (!isNaN(secs)) patch.duration = secs;
      }
      await updateCallTracker(callSid, patch);
    }

    return { ok: true };
  });

  // ── POST /api/webhook/languageOperator ────────────────────────────────────
  app.post("/api/webhook/languageOperator", async (req) => {
    const body = req.body as Record<string, string> ?? {};
    const viSid = body.TranscriptSid ?? body.transcriptSid ?? "";
    const callSid = body.CallSid ?? body.callSid ?? "";
    if (viSid && callSid) await updateCallTracker(callSid, { viSid });
    return { ok: true };
  });

  // ── POST /api/attractCall (attract-mode: initiate call without user details) ─
  app.post("/api/attractCall", async (req, reply) => {
    const ngrokBase = getPublicBaseUrl(req);

    try {
      const callSid = await initiateCall(ngrokBase);
      await seedCallTracker(callSid);
      return { success: true, callSid };
    } catch (err) {
      console.error("[attractCall] Error:", err);
      return reply.code(500).send({ success: false, error: String(err) });
    }
  });

  // ── POST /api/beans/swagQuestions (AI tool callback) ──────────────────────
  app.post("/api/beans/swagQuestions", async (req) => {
    const callSid = (req.headers as Record<string, string>)["x-call-sid"] ?? "";
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await updateCallTracker(callSid, { tasks: { ...current.tasks, swag_question_asked: true } });
    return { ok: true };
  });

  // ── POST /api/beans/twilioQuestion (AI tool callback) ─────────────────────────
  app.post("/api/beans/twilioQuestion", async (req) => {
    const callSid = (req.headers as Record<string, string>)["x-call-sid"] ?? "";
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await updateCallTracker(callSid, { tasks: { ...current.tasks, twilio_question_asked: true } });
    return { ok: true };
  });

  // ── GET /stats (basic-auth protected stats dashboard) ─────────────────────
  app.get("/stats", (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;
    const html = serveTemplated("stats.html", getStatsPageVars());
    reply.type("text/html").send(html);
  });

  // ── GET /swag (unified orders + inventory dashboard) ──────────────────────
  app.get("/swag", (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;
    const html = serveTemplated("swag.html", getStatsPageVars());
    reply.type("text/html").send(html);
  });

  // ── GET /api/stats (aggregated data from sync map) ────────────────────────
  app.get("/api/stats", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    const client = getTwilio();
    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

    const rawItems = await client.sync.v1.services(syncServiceSid)
      .syncMaps(SYNC_MAP_NAME).syncMapItems.list({ limit: 1000 });
    const items: CallTrackerItem[] = rawItems.map(i => i.data as CallTrackerItem);

    const total = items.length;
    const completed = items.filter(i => i.status === "completed");

    const orderRate      = total ? items.filter(i => i.tasks?.swag_order_placed).length    / total : 0;
    const questionRate   = total ? items.filter(i => i.tasks?.swag_question_asked).length  / total : 0;
    const bothRate       = total ? items.filter(i => i.tasks?.swag_order_placed && i.tasks?.swag_question_asked).length / total : 0;
    const twilioQuestionRate = total ? items.filter(i => i.tasks?.twilio_question_asked).length / total : 0;

    const msgCounts = items.map(i => (i.history ?? []).length);
    const avgMessages = total ? msgCounts.reduce((a, b) => a + b, 0) / total : 0;

    const withDuration = completed.filter(i => typeof i.duration === "number");
    const avgDuration  = withDuration.length
      ? withDuration.reduce((a, i) => a + i.duration!, 0) / withDuration.length
      : 0;

    const sentiment = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    for (const i of items) {
      const s = i.cintel?.sentiment;
      if (s === "positive" || s === "neutral" || s === "negative") sentiment[s]++;
      else sentiment.unknown++;
    }

    return { total, orderRate, questionRate, bothRate, twilioQuestionRate, avgMessages, avgDuration, sentiment };
  });

  // ── GET /api/orders (get all swag orders from Sync) ───────────────────────
  app.get("/api/orders", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    try {
      const client = getTwilio();
      const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

      const rawItems = await client.sync.v1.services(syncServiceSid)
        .syncMaps(SYNC_MAP_NAME).syncMapItems.list({ limit: 1000 });

      // Extract orders from sync items
      const orders: any[] = [];
      for (const syncItem of rawItems) {
        const item = syncItem.data as CallTrackerItem;
        if (item.order) {
          orders.push({
            callSid: syncItem.key,
            timestamp: item.order.timestamp,
            item: item.order.item,
            size: item.order.size || '',
            orderNumber: item.order.orderNumber,
            status: item.order.status || 'pending',
          });
        }
      }

      // Calculate summary
      const total = orders.length;
      const pending = orders.filter(o => o.status === 'pending').length;
      const completed = orders.filter(o => o.status === 'completed').length;

      // Find most popular item
      const itemCounts: Record<string, number> = {};
      orders.forEach(o => {
        itemCounts[o.item] = (itemCounts[o.item] || 0) + 1;
      });
      const topItem = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

      return {
        summary: { total, pending, completed, topItem },
        orders: orders.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      };
    } catch (err) {
      console.error("[api/orders] Error reading orders from Sync:", err);
      return reply.code(500).send({ error: "Failed to load orders" });
    }
  });

  // ── PATCH /api/orders/:callSid/complete (mark order as completed) ─────────
  app.patch("/api/orders/:callSid/complete", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    const { callSid } = req.params as { callSid: string };

    try {
      const syncItem = await getSyncItem(callSid).fetch();
      const current = syncItem.data as CallTrackerItem;

      if (!current.order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      await updateCallTracker(callSid, {
        order: {
          ...current.order,
          status: "completed",
        },
      });

      return { success: true, status: "completed" };
    } catch (err) {
      console.error("[complete-order] Error:", err);
      return reply.code(500).send({ error: "Failed to complete order" });
    }
  });

  // ── GET /api/inventory (get inventory from Sync) ──────────────────────────
  app.get("/api/inventory", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    try {
      const doc = await getInventoryDoc();
      return doc.data;
    } catch (err) {
      console.error("[api/inventory] Error reading inventory:", err);
      return reply.code(500).send({ error: "Failed to load inventory" });
    }
  });

  // ── PUT /api/inventory (update entire inventory in Sync) ──────────────────
  app.put("/api/inventory", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    try {
      const body = req.body as any;
      await updateInventory(body);
      return { success: true };
    } catch (err) {
      console.error("[api/inventory] Error updating inventory:", err);
      return reply.code(500).send({ error: "Failed to update inventory" });
    }
  });

  // ── POST /api/inventory/reset (reset inventory to defaults) ───────────────
  app.post("/api/inventory/reset", async (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;

    try {
      const defaultInventory = getDefaultInventory();
      await updateInventory(defaultInventory);
      console.log("[api/inventory/reset] Inventory reset to defaults");
      return { success: true, inventory: defaultInventory };
    } catch (err) {
      console.error("[api/inventory/reset] Error resetting inventory:", err);
      return reply.code(500).send({ error: "Failed to reset inventory" });
    }
  });

  // ── POST /api/beans/swagOrder (AI tool callback) ──────────────────────────
  app.post("/api/beans/swagOrder", async (req) => {
    const headers = req.headers as Record<string, string>;
    const callSid = headers["x-call-sid"] ?? "";
    const body = req.body as Record<string, unknown> ?? {};
    const { item, size = "" } = body as { item?: string; size?: string };

    if (!item) {
      return { error: "item is required" };
    }

    // Validate against current inventory
    try {
      const inventoryDoc = await getInventoryDoc();
      const inventoryData = inventoryDoc.data as any;
      const inventoryItem = inventoryData.items.find(
        (i: any) => i.name.toLowerCase() === item.toLowerCase()
      );

      if (!inventoryItem) {
        console.log(`[swag-order] Item "${item}" not found in inventory`);
        return { error: `Item "${item}" is not available` };
      }

      if (!inventoryItem.enabled) {
        console.log(`[swag-order] Item "${item}" is disabled in inventory`);
        return { error: `Item "${item}" is currently unavailable` };
      }

      // Validate size for items that have sizes
      if (inventoryItem.hasSize && inventoryItem.sizes && inventoryItem.sizes.length > 0) {
        if (!size) {
          console.log(`[swag-order] Size required for "${item}" but not provided`);
          return { error: `Size is required for ${item}. Available sizes: ${inventoryItem.sizes.join(', ')}` };
        }
        const validSize = inventoryItem.sizes.some(
          (s: string) => s.toLowerCase() === size.toLowerCase()
        );
        if (!validSize) {
          console.log(`[swag-order] Invalid size "${size}" for "${item}"`);
          return { error: `Invalid size "${size}". Available sizes: ${inventoryItem.sizes.join(', ')}` };
        }
      }
    } catch (err) {
      console.error("[swag-order] Error validating inventory:", err);
      return { error: "Failed to validate item availability" };
    }

    // Check if this call already has an order
    try {
      const syncItem = await getSyncItem(callSid).fetch();
      const current = syncItem.data as CallTrackerItem;

      if (current.order) {
        console.log(`[swag-order] Duplicate order attempt for ${callSid} - rejecting`);
        return {
          error: "Order already placed. Only one item per call allowed.",
          orderNumber: current.order.orderNumber,
        };
      }
    } catch (err) {
      console.error("[swag-order] Error checking existing order:", err);
    }

    // Check if mixologist integration is enabled
    const mixologistEnabled = process.env.ENABLE_MIXOLOGIST === "true";
    const mixologistBase = process.env.MIXOLOGIST_BASE_URL;
    const mixologistAuth = process.env.MIXOLOGIST_AUTH;

    let orderNumber: string | number = "N/A";

    // Build modifiers array (only include size if provided)
    const modifiers = size ? [size] : [];

    // Only send to mixologist if enabled and configured
    if (mixologistEnabled && mixologistBase && mixologistAuth) {
      const externalPayload = {
        event: "ai-summit-london",
        order: {
          status: "queued",
          key: new Date().toISOString(),
          manual: true,
          address: "Manual Swag Order",
          name: "AI Swag Booth",
          item,
          originalText: "",
          modifiers,
        },
      };

      try {
        const res = await fetch(`${mixologistBase}/api/order`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(mixologistAuth + ":")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(externalPayload),
        });
        const data = await res.json().catch(() => null) as { key?: string | number } | null;
        if (res.ok) {
          orderNumber = data?.key ?? orderNumber;
        } else {
          console.error("[order] Mixologist error:", res.status, data);
        }
      } catch (err) {
        console.error("[order] Mixologist fetch error:", err);
      }
    } else {
      // Mixologist disabled - use auto-incrementing order number from Sync
      orderNumber = await incrementOrderCounter();
      console.log(`[swag-order] Fulfillment backend disabled. Generated order #${orderNumber}`);
    }

    const timestamp = new Date().toISOString();

    try {
      const syncItem = await getSyncItem(callSid).fetch();
      const current = syncItem.data as CallTrackerItem;
      await updateCallTracker(callSid, {
        tasks: {
          swag_order_placed: true,
          swag_question_asked: current.tasks.swag_question_asked,
          twilio_question_asked: current.tasks.twilio_question_asked,
        },
        order: {
          item,
          size: size || undefined,
          timestamp,
          orderNumber,
          status: "pending",
        },
      });
    } catch (err) {
      console.error("[order] Sync error:", err);
    }

    return { orderNumber };
  });

}
