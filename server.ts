import { config } from "dotenv";
import {
  createLogger,
  TAC,
  TACConfig,
  TACServer,
  VoiceChannel,
} from "twilio-agent-connect";
import { clearConversation, handleMessage } from "./agent.ts";

config();

const tac = await TAC.create({
  config: TACConfig.fromEnv(),
  logger: createLogger({ level: "warn" }),
});
const voiceChannel = new VoiceChannel(tac, { memoryMode: "always" });

tac.registerChannel(voiceChannel);

tac.onMessageReady(async ({ conversationId, message, memory, session }) => {
  const convId = conversationId as string;
  console.log(`Received message for conversation ${convId}: ${message}`);
  return handleMessage(convId, message, memory, session);
});

tac.onConversationEnded(({ session }) => {
  clearConversation(session.conversationId as string);
});

const server = new TACServer(tac, {
  webhookPaths: { cintel: "/cintel-callback" },
  conversationRelayConfig: {
    welcomeGreeting: "Welcome to our barista expert service! How can I help you with your coffee today?",
    welcomeGreetingInterruptible: "any",
    language: "multi",
    transcriptionProvider: "Deepgram",
    speechModel: "flux",
  },
});
await server.start();
