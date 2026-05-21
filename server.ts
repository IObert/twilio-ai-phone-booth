import { config } from "dotenv";
import { TAC, TACConfig, TACServer, VoiceChannel } from "twilio-agent-connect";
import { clearConversation, handleMessage } from "./agent.ts";

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
});

voiceChannel.on("webSocketConnected", ({ conversationId }: { conversationId: string }) => {
  if (pendingCallSid) {
    callSidByConversationId.set(conversationId, pendingCallSid);
    pendingCallSid = undefined;
  }
});

voiceChannel.on("webSocketDisconnected", ({ conversationId }: { conversationId: string }) => {
  callSidByConversationId.delete(conversationId);
});

tac.onMessageReady(async ({ conversationId, message, memory, session }) => {
  const convId = conversationId as string;
  console.log(`Received message for conversation ${convId}: ${message}`);
  return handleMessage(convId, message, memory, session, () => callSidByConversationId.get(convId));
});

tac.onConversationEnded(({ session }) => {
  clearConversation(session.conversationId as string);
});

const server = new TACServer(tac, {
  webhookPaths: { cintel: "/cintel-callback" },
  conversationRelayConfig: {
    welcomeGreeting:
      "Welcome to our barista expert service! How can I help you with your coffee today?",
    welcomeGreetingInterruptible: "any",
    language: "multi",
    transcriptionProvider: "Deepgram",
    speechModel: "flux",
  },
});
await server.start();
