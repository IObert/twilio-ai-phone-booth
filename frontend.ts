/**
 * Frontend API layer — all routes and WebSockets for the booth display.
 * Imported by server.ts and registered on the shared Fastify instance.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import twilio from "twilio";
import { WELCOME_GREETING, drinkLabel, drinkIcon, venueLabel, roleLabel, menuNames } from "./agent.ts";
import { updateCallTracker, getSyncItem, SYNC_MAP_NAME, SYNC_ITEM_TTL, type CallTrackerItem, type CintelSummary } from "./sync.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
function serveTemplated(file: string, vars: Record<string, string>): string {
  let html = readFileSync(join(__dirname, "public", file), "utf8");
  for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`%%${k}%%`, v);
  return html;
}

function buildHeader(heroImage: string, roleLabel: string, venueLabel: string, rightSlot: string, linked = false): string {
  return serveTemplated("_header.html", {
    HERO_IMAGE:        heroImage,
    ROLE_LABEL:        roleLabel,
    VENUE_LABEL:       venueLabel,
    HEADER_RIGHT:      rightSlot,
    HEADER_LINK_START: linked ? `<a href="/start" style="display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit;">` : "",
    HEADER_LINK_END:   linked ? `</a>` : "",
  });
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
    .header("WWW-Authenticate", 'Basic realm="Twilio Stats"')
    .send("Unauthorized");
  return false;
}

// ─── plugin ───────────────────────────────────────────────────────────────────

export async function registerFrontendRoutes(app: FastifyInstance): Promise<void> {

  // ── Clean HTML routes ─────────────────────────────────────────────────────
  app.get("/", (_, reply) => reply.redirect("/start"));

  const heroImage     = drinkLabel === "smoothie" ? "smoothie.png" : "barista.png";
  const drinkLabelCap = drinkLabel.charAt(0).toUpperCase() + drinkLabel.slice(1);

  app.get("/start", (_, reply) => {
    const html = serveTemplated("start.html", {
      ATTRACT_MODE:    process.env.ATTRACT_MODE === "true" ? "true" : "false",
      ATTRACT_DEV:     process.env.ATTRACT_DEV  === "true" ? "true" : "false",
      VENUE_LABEL:     venueLabel,
      DRINK_LABEL:     drinkLabel,
      DRINK_LABEL_CAP: drinkLabelCap,
      DRINK_ICON:      drinkIcon,
      ROLE_LABEL:      roleLabel,
      MENU_SUMMARY:    menuNames.slice(0, 5).join(", ") + (menuNames.length > 5 ? " and more" : ""),
      HERO_IMAGE:      heroImage,
    });
    reply.type("text/html").send(html);
  });
  app.get("/call", (_, reply) => {
    const header = buildHeader(heroImage, roleLabel, venueLabel,
      `<div class="header-badge" id="callStatus"><div class="dot"></div><span>Connecting…</span></div>`);
    const html = serveTemplated("call.html", {
      HEADER:          header,
      VENUE_LABEL:     venueLabel,
      DRINK_LABEL_CAP: drinkLabelCap,
      HERO_IMAGE:      heroImage,
    });
    reply.type("text/html").send(html);
  });
  app.get("/summary", (_, reply) => {
    const header = buildHeader(heroImage, roleLabel, venueLabel,
      `<div class="header-done">✓ Call complete</div>`, true);
    const html = serveTemplated("summary.html", { HEADER: header, VENUE_LABEL: venueLabel });
    reply.type("text/html").send(html);
  });

  // ── GET /intelligence-results (health check) ─────────────────────────────
  app.get("/intelligence-results", (_, reply) => {
    reply.send({ ok: true, service: "tac-voice", endpoint: "intelligence-results" });
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
    const body = req.body as Record<string, string> | undefined ?? {};
    const participantName: string = body.name ?? "Guest";
    const participantEmail: string = body.email ?? `guest-${Date.now()}@owlbeans.demo`;

    const client = getTwilio();
    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
    const sipAddress = process.env.SIP_PHONE_ADDRESS!;
    const from = process.env.TWILIO_PHONE_NUMBER!;
    const ngrokBase = getPublicBaseUrl(req);

    // 1. Place outbound call — callSid is the session identifier
    let callSid: string;
    try {
      const call = await client.calls.create({
        to: sipAddress,
        from,
        url: `${ngrokBase}/twiml`,
        statusCallback: `${ngrokBase}/api/callStatus`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      });
      callSid = call.sid;
    } catch (err) {
      console.error("[startBoothCall] Call error:", err);
      return reply.code(500).send({ success: false, error: String(err) });
    }

    // 2. Ensure callTracker map exists, then seed the item for this call
    try {
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
            tasks: { order_placed: false, drink_question_asked: false, guindex_question_asked: false },
            history: [{ role: "ai", text: WELCOME_GREETING }],
          } satisfies CallTrackerItem,
        });
    } catch (err) {
      console.error("[startBoothCall] Sync error:", err);
    }


    return { success: true, callSid };
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
    const client = getTwilio();
    const sipAddress = process.env.SIP_PHONE_ADDRESS!;
    const from = process.env.TWILIO_PHONE_NUMBER!;
    const ngrokBase = getPublicBaseUrl(req);
    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;

    let callSid: string;
    try {
      const call = await client.calls.create({
        to: sipAddress,
        from,
        url: `${ngrokBase}/twiml`,
        statusCallback: `${ngrokBase}/api/callStatus`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      });
      callSid = call.sid;
    } catch (err) {
      console.error("[attractCall] Call error:", err);
      return reply.code(500).send({ success: false, error: String(err) });
    }

    try {
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
            tasks: { order_placed: false, drink_question_asked: false, guindex_question_asked: false },
            history: [{ role: "ai", text: WELCOME_GREETING }],
          } satisfies CallTrackerItem,
        });
    } catch (err) {
      console.error("[attractCall] Sync error:", err);
    }

    return { success: true, callSid };
  });

  // ── POST /api/beans/drinkQuestions (AI tool callback) ────────────────────
  app.post("/api/beans/drinkQuestions", async (req) => {
    const callSid = (req.headers as Record<string, string>)["x-call-sid"] ?? "";
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await updateCallTracker(callSid, { tasks: { ...current.tasks, drink_question_asked: true } });
    return { ok: true };
  });

  // ── POST /api/beans/guindexQuestion (AI tool callback) ───────────────────
  app.post("/api/beans/guindexQuestion", async (req) => {
    const callSid = (req.headers as Record<string, string>)["x-call-sid"] ?? "";
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await updateCallTracker(callSid, { tasks: { ...current.tasks, guindex_question_asked: true } });
    return { ok: true };
  });

  // ── GET /stats (basic-auth protected dashboard) ───────────────────────────
  app.get("/stats", (req, reply) => {
    if (!requireBasicAuth(req, reply)) return;
    reply.sendFile("stats.html");
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

    const orderRate      = total ? items.filter(i => i.tasks?.order_placed).length    / total : 0;
    const questionRate   = total ? items.filter(i => i.tasks?.drink_question_asked).length  / total : 0;
    const bothRate       = total ? items.filter(i => i.tasks?.order_placed && i.tasks?.drink_question_asked).length / total : 0;
    const guindexRate  = total ? items.filter(i => i.tasks?.guindex_question_asked).length     / total : 0;

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

    return { total, orderRate, questionRate, bothRate, guindexRate, avgMessages, avgDuration, sentiment, drinkLabel };
  });

  // ── POST /api/beans/order (AI tool callback) ──────────────────────────────
  app.post("/api/beans/order", async (req) => {
    const headers = req.headers as Record<string, string>;
    const callSid = headers["x-call-sid"] ?? "";
    const body = req.body as Record<string, unknown> ?? {};
    const { item, modifiers = [] } = body as { item?: string; modifiers?: string[] };

    if (!item) {
      return { error: "item is required" };
    }

    const mixologistBase = process.env.MIXOLOGIST_BASE_URL!;
    const mixologistAuth = process.env.MIXOLOGIST_AUTH!;

    const externalPayload = {
      event: process.env.EVENT_NAME ?? "signal-berlin",
      order: {
        status: "queued",
        key: new Date().toISOString(),
        manual: true,
        address: "Manual Order",
        name: "AI Phone Booth",
        item,
        originalText: "",
        modifiers,
      },
    };

    let orderNumber: string | number = "N/A";
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

    try {
      const syncItem = await getSyncItem(callSid).fetch();
      const current = syncItem.data as CallTrackerItem;
      await updateCallTracker(callSid, {
        tasks: { order_placed: true, drink_question_asked: current.tasks.drink_question_asked, guindex_question_asked: current.tasks.guindex_question_asked },
      });
    } catch (err) {
      console.error("[order] Sync error:", err);
    }

    return { orderNumber };
  });

}
