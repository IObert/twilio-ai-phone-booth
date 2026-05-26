/**
 * Frontend API layer — all routes and WebSockets for the booth display.
 * Imported by server.ts and registered on the shared Fastify instance.
 *
 * All Twilio/Segment credentials are read from env at call time so this
 * module can be imported before dotenv runs its side-effects.
 */

import type { FastifyInstance } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import twilio from "twilio";

// ─── types ────────────────────────────────────────────────────────────────────

interface ConversationClient {
  ws: WebSocket;
  code?: string;
}

interface ReadyClient {
  ws: WebSocket;
}

// ─── in-process state ─────────────────────────────────────────────────────────

// code → participant email (populated by startBoothCall, read by getSegmentProfile)
const sessionEmail = new Map<string, string>();

// conversationClients: subscribe to live call events (Screen 2)
const conversationClients = new Set<ConversationClient>();

// readyClients: home-screen keep-alive, can receive chooseScenario pushes
const readyClients = new Set<ReadyClient>();

// ─── helpers ──────────────────────────────────────────────────────────────────

function randomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function broadcast(clients: Set<ConversationClient>, payload: unknown, code?: string): void {
  const msg = JSON.stringify(payload);
  for (const c of clients) {
    if (code === undefined || c.code === code) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
    }
  }
}

function getTwilio() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

// ─── plugin ───────────────────────────────────────────────────────────────────

export async function registerFrontendRoutes(app: FastifyInstance): Promise<void> {

  // ── Clean HTML routes ─────────────────────────────────────────────────────
  app.get("/", (_, reply) => reply.redirect("/start"));
  app.get("/start", (_, reply) => reply.sendFile("start.html"));
  app.get("/call", (_, reply) => reply.sendFile("call.html"));
  app.get("/summary", (_, reply) => reply.sendFile("summary.html"));

  // ── POST /api/startBoothCall ───────────────────────────────────────────────
  app.post("/api/startBoothCall", async (req, reply) => {
    const body = req.body as Record<string, string> | undefined ?? {};
    const participantName: string = body.name ?? "Guest";
    const participantEmail: string = body.email ?? `guest-${Date.now()}@owlbeans.demo`;

    const code = randomCode();
    sessionEmail.set(code, participantEmail);

    const client = getTwilio();
    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
    const sipAddress = process.env.SIP_PHONE_ADDRESS!;
    const from = process.env.TWILIO_PHONE_NUMBER!;
    const ngrokBase = process.env.NGROK_BASE_URL ?? "https://mobert.ngrok.io";

    // 1. Create Sync map entry
    try {
      await client.sync.v1.services(syncServiceSid).syncMaps(code).fetch().catch(() =>
        client.sync.v1.services(syncServiceSid).syncMaps.create({ uniqueName: code })
      );
      // Seed initial task state
      await client.sync.v1.services(syncServiceSid).syncMaps(code).syncMapItems.create({
        key: "tasks",
        data: { coffee_question_asked: false, coffee_order_placed: false },
      }).catch(() => {}); // ignore if already exists
    } catch (err) {
      console.error("[startBoothCall] Sync error:", err);
    }

    // 2. Segment identify (fire-and-forget)
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
          traits: { name: participantName, email: participantEmail, sessionCode: code },
        }),
      });
    } catch (err) {
      console.error("[startBoothCall] Segment error:", err);
    }

    // 3. Place outbound call to SIP phone
    try {
      await client.calls.create({
        to: sipAddress,
        from,
        url: `${ngrokBase}/twiml`,
        statusCallback: `${ngrokBase}/api/transcriptions`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      });
    } catch (err) {
      console.error("[startBoothCall] Call error:", err);
      return reply.code(500).send({ success: false, error: String(err) });
    }

    return { success: true, code };
  });

  // ── POST /api/heartbeat ────────────────────────────────────────────────────
  app.post("/api/heartbeat", async () => ({ ok: true }));

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

  // ── POST /api/getSegmentProfile ────────────────────────────────────────────
  app.post("/api/getSegmentProfile", async (req, reply) => {
    const { code } = req.body as { code?: string } ?? {};
    if (!code) return reply.code(400).send({ error: "code required" });

    const email = sessionEmail.get(code);
    if (!email) return reply.code(404).send({ error: "unknown session" });

    try {
      const spaceId = process.env.SEGMENT_SPACE_ID!;
      const accessToken = process.env.SEGMENT_ACCESS_TOKEN!;
      const res = await fetch(
        `https://profiles.segment.com/v1/spaces/${spaceId}/collections/users/profiles/email:${encodeURIComponent(email)}/traits`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(accessToken + ":").toString("base64")}`,
          },
        },
      );
      if (!res.ok) return reply.code(res.status).send({ error: await res.text() });
      const data = await res.json() as { traits?: unknown };
      return { traits: data.traits ?? {} };
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
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

  // ── POST /api/transcriptions (Twilio CI webhook) ───────────────────────────
  app.post("/api/transcriptions", async (req) => {
    const body = req.body as Record<string, string> ?? {};
    const event = body.TranscriptionEvent ?? body.transcriptionEvent;
    const callSid = body.CallSid ?? body.callSid;

    if (event === "transcription-started") {
      broadcast(conversationClients, { type: "startCall", callSid });
    } else if (event === "transcription-content") {
      broadcast(conversationClients, {
        type: "userTranscript",
        text: body.TranscriptionData ?? body.transcriptionData ?? "",
        callSid,
        isFinal: body.Final === "true",
      });
    } else if (event === "transcription-stopped") {
      broadcast(conversationClients, { type: "endCall", callSid });
    }

    return { ok: true };
  });

  // ── POST /api/webhook/languageOperator ────────────────────────────────────
  app.post("/api/webhook/languageOperator", async (req) => {
    const body = req.body as Record<string, string> ?? {};
    const sid = body.TranscriptSid ?? body.transcriptSid ?? "";
    broadcast(conversationClients, { type: "voiceIntelligenceSid", sid });
    return { ok: true };
  });

  // ── POST /api/beans/coffeeQuestions (AI tool callback) ────────────────────
  app.post("/api/beans/coffeeQuestions", async (req) => {
    const headers = req.headers as Record<string, string>;
    const code = headers["x-session-id"] ?? "";
    const body = req.body as Record<string, string> ?? {};

    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
    try {
      const client = getTwilio();
      await client.sync.v1.services(syncServiceSid).syncMaps(code).syncMapItems("tasks").update({
        data: { coffee_question_asked: true, question: body.question ?? "" },
      });
    } catch (err) {
      console.error("[coffeeQuestions] Sync error:", err);
    }

    broadcast(conversationClients, {
      type: "toolCard",
      tool: "coffeeQuestion",
      question: body.question ?? "",
    }, code || undefined);

    return { ok: true };
  });

  // ── POST /api/beans/order (AI tool callback) ──────────────────────────────
  app.post("/api/beans/order", async (req) => {
    const headers = req.headers as Record<string, string>;
    const code = headers["x-session-id"] ?? "";
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

    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
    try {
      const client = getTwilio();
      await client.sync.v1.services(syncServiceSid).syncMaps(code).syncMapItems("tasks").update({
        data: { coffee_order_placed: true, orderNumber },
      });
    } catch (err) {
      console.error("[order] Sync error:", err);
    }

    broadcast(conversationClients, {
      type: "toolCard",
      tool: "order",
      item: body.item,
      modifiers: body.modifiers,
      orderNumber,
    }, code || undefined);

    return { orderNumber };
  });

  // ─── WebSocket: /api/ws/callConversation ─────────────────────────────────
  const wssCall = new WebSocketServer({ noServer: true });
  wssCall.on("connection", (ws: WebSocket) => {
    const client: ConversationClient = { ws };
    conversationClients.add(client);

    let heartbeat: ReturnType<typeof setInterval> | null = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; code?: string };
        if (msg.type === "pollHistory") {
          client.code = msg.code;
          // Send any cached history (placeholder — real impl would read from Sync)
          ws.send(JSON.stringify({ type: "history", messages: [] }));
          // Start keep-alive ping
          heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
          }, 5000);
        } else if (msg.type === "endCall") {
          client.code = undefined;
        }
      } catch {}
    });

    ws.on("close", () => {
      conversationClients.delete(client);
      if (heartbeat) clearInterval(heartbeat);
    });
  });

  // ─── WebSocket: /api/ws/ready ─────────────────────────────────────────────
  const wssReady = new WebSocketServer({ noServer: true });
  wssReady.on("connection", (ws: WebSocket) => {
    const client: ReadyClient = { ws };
    readyClients.add(client);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
        if (msg.type === "chooseScenario") {
          // Relay to all ready clients (demo kiosk mode)
          const out = JSON.stringify({ type: "navigate", path: "/scenario", data: msg });
          for (const c of readyClients) {
            if (c.ws !== ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
          }
        }
      } catch {}
    });

    ws.on("close", () => readyClients.delete(client));
  });

  // Attach WS upgrade handler to Fastify's underlying HTTP server
  app.server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/ws/callConversation")) {
      wssCall.handleUpgrade(req, socket, head, (ws) => wssCall.emit("connection", ws, req));
    } else if (url.startsWith("/api/ws/ready")) {
      wssReady.handleUpgrade(req, socket, head, (ws) => wssReady.emit("connection", ws, req));
    }
  });
}
