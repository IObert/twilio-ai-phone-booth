import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  TACServer,
  MemoryPromptBuilder,
  createLogger,
} from 'twilio-agent-connect';

config();

const openai = new OpenAI();

// Initialize TAC and channels
const tac = await TAC.create({ config: TACConfig.fromEnv(), logger: createLogger({ level: 'warn' }) });
const voiceChannel = new VoiceChannel(tac);
// const smsChannel = new SMSChannel(tac);

// Register channels
tac.registerChannel(voiceChannel);
// tac.registerChannel(smsChannel);

// Store conversation history
const conversationHistory: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

// System instructions for the AI agent
const SYSTEM_INSTRUCTIONS =
  'You are a customer service agent speaking with a user over voice or SMS. ' +
  'Keep responses short and conversational — a sentence or two. ' +
  'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
  'spoken aloud or sent as plain text. Always reply in the same language the user is speaking. ';
// Handle incoming messages
tac.onMessageReady(async ({ conversationId, message, memory, session }) => {
  const convId = conversationId as string;

  if (!conversationHistory[convId]) {
    conversationHistory[convId] = [];
  }

  // Build system prompt with memory context using compose()
  const systemPrompt = MemoryPromptBuilder.compose(SYSTEM_INSTRUCTIONS, memory, session);

  conversationHistory[convId].push({ role: 'user', content: message });

  console.log(`Received message for conversation ${convId}: ${message}`);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory[convId],
    ],
  });

  const llmResponse = response.choices[0]?.message?.content ?? '';
  conversationHistory[convId].push({ role: 'assistant', content: llmResponse });

  return llmResponse;
});

const server = new TACServer(tac);
await server.start();