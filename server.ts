import { config } from "dotenv";
import Fastify from "fastify";
import { TAC, TACConfig, TACServer, VoiceChannel } from "twilio-agent-connect";
import { clearConversation, handleMessage, promoteSession, warmSession, WELCOME_GREETING } from "./agent.ts";
import { registerFrontendRoutes } from "./frontend.ts";

config();

const tac = await TAC.create({
  config: TACConfig.fromEnv(),
});
const voiceChannel = new VoiceChannel(tac, { memoryMode: "always" });

tac.registerChannel(voiceChannel);

// Map conversationId → callSid so the agent can terminate calls
const callSidByConversationId = new Map<string, string>();
let pendingCallSid: string | undefined;

voiceChannel.on("setup", ({ callSid }: { callSid: string }) => {
  pendingCallSid = callSid;
  warmSession(callSid);
});

voiceChannel.on(
  "webSocketConnected",
  ({ conversationId }: { conversationId: string }) => {
    if (pendingCallSid) {
      callSidByConversationId.set(conversationId, pendingCallSid);
promoteSession(pendingCallSid, conversationId, () => callSidByConversationId.get(conversationId));
      pendingCallSid = undefined;
    }
  },
);

voiceChannel.on(
  "webSocketDisconnected",
  ({ conversationId }: { conversationId: string }) => {
    callSidByConversationId.delete(conversationId);
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

const app = Fastify({ logger: true, trustProxy: true });

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
