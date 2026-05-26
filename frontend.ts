/**
 * Frontend API layer — all routes and WebSockets for the booth display.
 * Imported by server.ts and registered on the shared Fastify instance.
 */

import type { FastifyInstance } from "fastify";
import twilio from "twilio";
import { WELCOME_GREETING } from "./agent.ts";

// ─── types ────────────────────────────────────────────────────────────────────

interface OperatorResult {
  operator: { displayName: string };
  outputFormat: "CLASSIFICATION" | "TEXT";
  result: { label?: string; text?: string };
  referenceIds?: string[];
}

interface CintelSummary {
  sentiment?: string;   // label from Sentiment operator
  summary?: string;     // text from Summary operator
  // TODO: add fields for additional operators here (e.g. topics, entities)
}

interface CallTrackerItem {
  status: "calling" | "in-progress" | "completed";
  tasks: { coffee_order_placed: boolean; coffee_question_asked: boolean };
  history: { role: "user" | "ai"; text: string }[];
  viSid?: string;
  cintel?: CintelSummary;
}

// ─── constants ────────────────────────────────────────────────────────────────

const SYNC_MAP_NAME = "callTracker";
const SYNC_ITEM_TTL = 14400; // 4 hours in seconds

// ─── in-process state ─────────────────────────────────────────────────────────

// callSid → participant email
const sessionEmail = new Map<string, string>();

// ─── helpers ──────────────────────────────────────────────────────────────────

function getTwilio() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

function getSyncItem(callSid: string) {
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  return getTwilio().sync.v1.services(syncServiceSid)
    .syncMaps(SYNC_MAP_NAME).syncMapItems(callSid);
}

async function updateCallTracker(callSid: string, patch: Partial<CallTrackerItem>): Promise<void> {
  try {
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await getSyncItem(callSid).update({
      data: { ...current, ...patch },
      ttl: SYNC_ITEM_TTL,
    });
  } catch (err) {
    console.error(`[sync] updateCallTracker error (${callSid}):`, err);
  }
}

// ─── plugin ───────────────────────────────────────────────────────────────────

export async function registerFrontendRoutes(app: FastifyInstance): Promise<void> {

  // ── Clean HTML routes ─────────────────────────────────────────────────────
  app.get("/", (_, reply) => reply.redirect("/start"));
  app.get("/start", (_, reply) => reply.sendFile("start.html"));
  app.get("/call", (_, reply) => reply.sendFile("call.html"));
  app.get("/summary", (_, reply) => reply.sendFile("summary.html"));

  // ── POST /cintel-callback (Conversation Intelligence results) ─────────────
  app.post("/cintel-callback", async (req) => {
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
    const ngrokBase = process.env.NGROK_BASE_URL ?? "https://mobert.ngrok.io";

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

    sessionEmail.set(callSid, participantEmail);

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
            tasks: { coffee_order_placed: false, coffee_question_asked: false },
            history: [{ role: "ai", text: WELCOME_GREETING }],
          } satisfies CallTrackerItem,
        });
    } catch (err) {
      console.error("[startBoothCall] Sync error:", err);
    }

    // 3. Segment identify (fire-and-forget)
    try {
      const segmentWriteKey = process.env.SEGMENT_WRITE_KEY!;
      await fetch("https://api.segment.io/v1/identify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(segmentWriteKey + ":").toString("base64")}`,
        },
        body: JSON.stringify({
          userId: participantEmail,
          traits: { name: participantName, email: participantEmail },
        }),
      });
    } catch (err) {
      console.error("[startBoothCall] Segment error:", err);
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

  // ── POST /api/getVIToken ───────────────────────────────────────────────────
  app.post("/api/getVIToken", async (req, reply) => {
    const { transcriptSid } = req.body as { transcriptSid?: string } ?? {};
    if (!transcriptSid) return reply.code(400).send({ error: "transcriptSid required" });

    try {
      // Placeholder: real impl would call Twilio AI tokens API for a one-time embed token
      return { transcriptSid, url: `https://intelligence.twilio.com/transcripts/${transcriptSid}` };
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });

  // ── POST /api/callStatus (Twilio call status callback) ───────────────────
  app.post("/api/callStatus", async (req) => {
    const body = req.body as Record<string, string> ?? {};
    const callSid = body.CallSid;
    const callStatus = body.CallStatus;

    if (!callSid || !callStatus) return { ok: true };

    const statusMap: Record<string, CallTrackerItem["status"]> = {
      initiated:   "calling",
      ringing:     "calling",
      "in-progress": "in-progress",
      answered:    "in-progress",
      completed:   "completed",
      failed:      "completed",
      busy:        "completed",
      "no-answer": "completed",
    };

    const syncStatus = statusMap[callStatus];
    if (syncStatus) {
      await updateCallTracker(callSid, { status: syncStatus });
    }

    if (callStatus === "completed") {
      setTimeout(() => sessionEmail.delete(callSid), 60_000);
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

  // ── POST /api/beans/coffeeQuestions (AI tool callback) ────────────────────
  app.post("/api/beans/coffeeQuestions", async (req) => {
    const headers = req.headers as Record<string, string>;
    const callSid = headers["x-call-sid"] ?? "";

    try {
      const item = await getSyncItem(callSid).fetch();
      const current = item.data as CallTrackerItem;
      await getSyncItem(callSid).update({
        ttl: SYNC_ITEM_TTL,
        data: {
          ...current,
          tasks: { ...current.tasks, coffee_question_asked: true },
        },
      });
    } catch (err) {
      console.error("[coffeeQuestions] Sync error:", err);
    }

    return { ok: true };
  });

  // ── POST /api/beans/order (AI tool callback) ──────────────────────────────
  app.post("/api/beans/order", async (req) => {
    const headers = req.headers as Record<string, string>;
    const callSid = headers["x-call-sid"] ?? "";
    const body = req.body as Record<string, unknown> ?? {};

    const mixologistBase = process.env.MIXOLOGIST_BASE_URL ?? "https://mixologist.example.com";
    let orderNumber = "N/A";

    try {
      const res = await fetch(`${mixologistBase}/api/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as { orderNumber?: string };
        orderNumber = data.orderNumber ?? orderNumber;
      }
    } catch (err) {
      console.error("[order] Mixologist error:", err);
    }

    try {
      const item = await getSyncItem(callSid).fetch();
      const current = item.data as CallTrackerItem;
      await getSyncItem(callSid).update({
        ttl: SYNC_ITEM_TTL,
        data: {
          ...current,
          tasks: { ...current.tasks, coffee_order_placed: true },
        },
      });
    } catch (err) {
      console.error("[order] Sync error:", err);
    }

    return { orderNumber };
  });

}
