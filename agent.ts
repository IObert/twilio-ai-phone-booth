import { config } from "dotenv";
import OpenAI from "openai";
import twilio from "twilio";
import { MemoryPromptBuilder } from "twilio-agent-connect";
import type { ConversationSession, TACMemoryResponse } from "twilio-agent-connect";

config();
const openai = new OpenAI();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const BASE_URL = "https://mobert.ngrok.io/api/beans";

const SYSTEM_INSTRUCTIONS = `You are Jeff, a friendly and knowledgeable AI assistant working at Owl Beans during Twilio SIGNAL World Tour Berlin 2026.

Your goal is to have natural coffee conversations with customers and help them complete one of two tasks only:
1) Ask a coffee-related question
2) Place a coffee order

## Your Responsibilities

### 1. Answer Coffee Questions
When customers ask about coffee types, brewing methods, flavors, strength, caffeine, or drink differences, provide clear and helpful answers.

After answering a coffee-related question, call the complete_coffee_question tool to mark the task complete.

### 2. Create Coffee Orders
If the customer wants to order, help them choose from this menu:
- Espresso
- Cortado
- Latte
- Cappuccino
- Americano
- British Breakfast Tea
- Chai Latte
- Flat White

Once they confirm what they want, call submit_order immediately. Users always order their favorite drink, so update the trait on each new order.

## Conversation Goal
Keep the chat friendly and natural. Encourage the customer to mention personal details casually (name, preferences, context, etc.) so personalization data can be used in future calls.

## Important Boundaries
If users ask about detailed Twilio product/pricing/event topics, politely redirect them to human booth staff.
Keep your active help focused on coffee questions and coffee ordering.

## Finale Tip
When the conversation is ending, remind them they can claim a free Twilio gift at the welcome desk.

## Tone & Personality
- Friendly, enthusiastic, and helpful
- Coffee-savvy but approachable
- Efficient when users are in a hurry
- Professional and concise

## Tool Usage Rules
- Always call complete_coffee_question after answering a coffee-related question.
- Always call submit_order after the user confirms an order.
- It is critical to communicate the returned order number to the user.
- If the order submission fails, apologize and let the user know it failed.`;

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "complete_coffee_question",
      description:
        "Marks the coffee question task as complete after answering a customer's question about coffee types, brewing methods, or coffee-related topics. Call this after providing an answer to any coffee question.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_order",
      description:
        "Submit a coffee order for the user. Returns an order number — you must communicate this to the user. If the call fails, apologize and inform the user.",
      parameters: {
        type: "object",
        properties: {
          originalMessage: { type: "string" },
          item: {
            type: "string",
            enum: [
              "Espresso",
              "Cortado",
              "Latte",
              "Cappuccino",
              "Americano",
              "British Breakfast Tea",
              "Chai Latte",
              "Flat White",
            ],
          },
          modifiers: {
            type: "array",
            items: { type: "string", enum: ["Milk", "Oat Milk"] },
          },
        },
        required: ["originalMessage", "item", "modifiers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description: "Terminates the current phone call. Call this when the user asks to hang up, end the call, or says goodbye and is clearly done.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

const TOOL_URLS: Record<string, string> = {
  complete_coffee_question: `${BASE_URL}/coffeeQuestions`,
  submit_order: `${BASE_URL}/order`,
};

async function executeTool(name: string, args: unknown): Promise<string> {
  const res = await fetch(TOOL_URLS[name], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const conversationHistories: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

export async function handleMessage(
  convId: string,
  message: string,
  memory: TACMemoryResponse | undefined,
  session: ConversationSession,
  getCallSid: () => string | undefined,
): Promise<string> {
  const systemPrompt = MemoryPromptBuilder.compose(SYSTEM_INSTRUCTIONS, memory, session);

  if (!conversationHistories[convId]) {
    conversationHistories[convId] = [];
  }
  const history = conversationHistories[convId];
  history.push({ role: "user", content: message });

  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [{ role: "system", content: systemPrompt }, ...history],
      tools,
    });

    const assistantMessage = response.choices[0].message;
    history.push(assistantMessage);

    if (response.choices[0].finish_reason !== "tool_calls" || !assistantMessage.tool_calls?.length) {
      return assistantMessage.content ?? "";
    }

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;
      let result: string;
      if (toolCall.function.name === "end_call") {
        const callSid = getCallSid();
        if (callSid) {
          try {
            await twilioClient.calls(callSid).update({ status: "completed" });
            result = "Call terminated.";
          } catch (err) {
            result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
        } else {
          result = JSON.stringify({ error: "No active call SID found." });
        }
      } else {
        try {
          result = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      }
      history.push({ role: "tool", tool_call_id: toolCall.id, content: result });
    }
  }
}

export function clearConversation(convId: string): void {
  delete conversationHistories[convId];
}
