import { config } from "dotenv";
import Fastify from "fastify";
import { TAC, TACConfig, TACServer, VoiceChannel, createLogger } from "twilio-agent-connect";
import { clearConversation, handleMessage, promoteSession, warmSession, WELCOME_GREETING } from "./agent.ts";
import { registerFrontendRoutes } from "./frontend.ts";

config();

const silentLogger = createLogger({ level: "silent" });

const tac = await TAC.create({
  config: TACConfig.fromEnv(),
  logger: silentLogger,
});
const voiceChannel = new VoiceChannel(tac, { memoryMode: "always" });

tac.registerChannel(voiceChannel);

// Map conversationId → callSid so the agent can terminate calls
const callSidByConversationId = new Map<string, string>();
let pendingCallSid: string | undefined;
const pendingCallInfo = new Map<string, { agentPhone: string }>();

async function fixParticipantRoles(conversationId: string, agentPhone: string): Promise<void> {
  const apiKey = process.env.TWILIO_API_KEY!;
  const apiSecret = process.env.TWILIO_API_SECRET!;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const base = "https://conversations.twilio.com";

  const listRes = await fetch(`${base}/v2/Conversations/${conversationId}/Participants`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!listRes.ok) return;

  type Participant = { id: string; type?: string; addresses?: Array<{ channel: string; address: string }> };
  const { participants } = await listRes.json() as { participants: Participant[] };

  for (const p of participants) {
    const voiceAddr = p.addresses?.find((a) => a.channel === "VOICE")?.address;
    if (!voiceAddr) continue;
    const targetType = voiceAddr === agentPhone ? "AI_AGENT" : "CUSTOMER";
    if (p.type === targetType) continue;
    await fetch(`${base}/v2/Conversations/${conversationId}/Participants/${p.id}`, {
      method: "PUT",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: targetType, addresses: p.addresses }),
    });
  }
}

voiceChannel.on("setup", ({ callSid, from }: { callSid: string; from?: string }) => {
  pendingCallSid = callSid;
  if (from) pendingCallInfo.set(callSid, { agentPhone: from });
  warmSession(callSid);
});

voiceChannel.on(
  "webSocketConnected",
  ({ conversationId }: { conversationId: string }) => {
    if (pendingCallSid) {
      callSidByConversationId.set(conversationId, pendingCallSid);
      promoteSession(pendingCallSid, conversationId, () => callSidByConversationId.get(conversationId));
      const info = pendingCallInfo.get(pendingCallSid);
      if (info) {
        pendingCallInfo.delete(pendingCallSid);
        fixParticipantRoles(conversationId, info.agentPhone)
          .catch((err: unknown) => console.error(`[${conversationId}] fixParticipantRoles failed:`, err));
      }
      pendingCallSid = undefined;
    }
  },
);

voiceChannel.on(
  "webSocketDisconnected",
  ({ conversationId }: { conversationId: string }) => {
    callSidByConversationId.delete(conversationId);
    pendingCallInfo.delete(conversationId);
  },
);

tac.onMessageReady(async ({ conversationId, message, memory, session }) => {
  const convId = conversationId as string;
  const stream = handleMessage(
    convId,
    message,
    memory,
    session,
    () => callSidByConversationId.get(convId),
  );
  
  await voiceChannel.sendStreamingResponse(conversationId, stream);
  return null;
});

tac.onConversationEnded(({ session }) => {
  clearConversation(session.conversationId as string);
});

const app = Fastify({ logger: { level: "warn" }, trustProxy: true });

// Twilio webhooks POST application/x-www-form-urlencoded
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (err) {
      done(err as Error);
    }
  },
);

app.get("/health", async () => ({ status: "ok" }));

// Frontend API routes + WebSocket handlers
await registerFrontendRoutes(app);

// Serve public/ folder (scenario.html, call.html, assets)
await app.register(import("@fastify/static"), {
  root: new URL("./public", import.meta.url).pathname,
  prefix: "/",
});

const server = new TACServer(tac, {
  fastifyInstance: app,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8000,
  conversationRelayConfig: {
    welcomeGreeting:
      WELCOME_GREETING,
    welcomeGreetingInterruptible: "any",
    // transcriptionProvider: "Deepgram",
    // speechModel: "flux",
    language: "multi",
    elevenlabsTextNormalization: "on",
    ttsProvider: "ElevenLabs",
    voice: "ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.0_1.0_1.0",
  },
});
await server.start();
