import { config } from "dotenv";
import WebSocket from "ws";
import twilio from "twilio";
import { MemoryPromptBuilder } from "twilio-agent-connect";
import type { ConversationSession, TACMemoryResponse } from "twilio-agent-connect";

config();

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
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

const tools = [
  {
    type: "function",
    name: "complete_coffee_question",
    description:
      "Marks the coffee question task as complete after answering a customer's question about coffee types, brewing methods, or coffee-related topics. Call this after providing an answer to any coffee question.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    type: "function",
    name: "submit_order",
    description:
      "Submit a coffee order for the user. Returns an order number — you must communicate this to the user. If the call fails, apologize and inform the user.",
    parameters: {
      type: "object",
      properties: {
        originalMessage: { type: "string" },
        item: {
          type: "string",
          enum: ["Espresso", "Cortado", "Latte", "Cappuccino", "Americano", "British Breakfast Tea", "Chai Latte", "Flat White"],
        },
        modifiers: { type: "array", items: { type: "string", enum: ["Milk", "Oat Milk"] } },
      },
      required: ["originalMessage", "item", "modifiers"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "Terminates the current phone call. Call this when the user asks to hang up or says goodbye.",
    parameters: { type: "object", properties: {}, required: [] },
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

// ── Stream controller ──────────────────────────────────────────────────────────

interface StreamController {
  tokenQueue: string[];
  notify: (() => void) | null;
  finished: boolean;
  error: Error | null;
}

function pushToken(ctrl: StreamController, token: string): void {
  ctrl.tokenQueue.push(token);
  const n = ctrl.notify; ctrl.notify = null; n?.();
}

function finishStream(ctrl: StreamController): void {
  ctrl.finished = true;
  const n = ctrl.notify; ctrl.notify = null; n?.();
}

function errorStream(ctrl: StreamController, err: Error): void {
  ctrl.error = err;
  const n = ctrl.notify; ctrl.notify = null; n?.();
}

async function* drainStream(ctrl: StreamController): AsyncGenerator<string> {
  while (true) {
    if (ctrl.tokenQueue.length > 0) {
      yield ctrl.tokenQueue.shift()!;
    } else if (ctrl.error) {
      throw ctrl.error;
    } else if (ctrl.finished) {
      return;
    } else {
      await new Promise<void>((resolve) => { ctrl.notify = resolve; });
    }
  }
}

// ── Session state ──────────────────────────────────────────────────────────────

interface PendingRequest {
  payload: unknown;
  ctrl: StreamController;
}

interface ConversationState {
  ws: WebSocket;
  wsReady: boolean;
  wsQueue: string[];            // raw frames held until socket opens
  input: Array<{ role: string; content: string }>;
  busy: boolean;                // true while a response.create is in flight
  requestQueue: PendingRequest[]; // serialized user requests
  stream: StreamController | null;
  functionCalls: Map<string, { name: string; args: string; callId: string }>;
  getCallSid: () => string | undefined;
}

const sessions = new Map<string, ConversationState>();

// ── WS send helpers ────────────────────────────────────────────────────────────

function wsSend(state: ConversationState, payload: unknown): void {
  const json = JSON.stringify(payload);
  state.wsReady ? state.ws.send(json) : state.wsQueue.push(json);
}

function dispatchNext(convId: string, state: ConversationState): void {
  if (state.busy || state.requestQueue.length === 0) return;
  const next = state.requestQueue.shift()!;
  state.busy = true;
  state.stream = next.ctrl;
  const p = next.payload as Record<string, unknown>;
  const input = p.input as Array<unknown>;
  const last = input[input.length - 1] as Record<string, unknown>;
  wsSend(state, next.payload);
}

// ── Session creation ───────────────────────────────────────────────────────────

function createSession(
  convId: string,
  getCallSid: () => string | undefined,
  systemPrompt?: string,
): ConversationState {
  const ws = new WebSocket("wss://api.openai.com/v1/responses", {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });

  const state: ConversationState = {
    ws,
    wsReady: false,
    wsQueue: [],
    input: systemPrompt ? [{ role: "system", content: systemPrompt }] : [],
    busy: false,
    requestQueue: [],
    stream: null,
    functionCalls: new Map(),
    getCallSid,
  };

  ws.on("open", () => {
    console.log(`[${convId}] OpenAI WS connected`);
    state.wsReady = true;
    state.wsQueue.splice(0).forEach((m) => ws.send(m));
    dispatchNext(convId, state);
  });

  ws.on("message", (data: WebSocket.RawData) => {
    handleOpenAIEvent(convId, state, JSON.parse(data.toString())).catch((err) => {
      console.error(`[${convId}] event handler error:`, err);
      if (state.stream) { errorStream(state.stream, err instanceof Error ? err : new Error(String(err))); state.stream = null; }
      state.busy = false;
      dispatchNext(convId, state);
    });
  });

  ws.on("error", (err) => {
    console.error(`[${convId}] OpenAI WS error:`, err);
    if (state.stream) { errorStream(state.stream, err instanceof Error ? err : new Error(String(err))); state.stream = null; }
  });

  ws.on("close", (code) => {
    console.log(`[${convId}] OpenAI WS closed (${code})`);
    const err = new Error(`OpenAI WebSocket closed (${code})`);
    if (state.stream) { errorStream(state.stream, err); state.stream = null; }
    for (const r of state.requestQueue) errorStream(r.ctrl, err);
    state.requestQueue.length = 0;
    sessions.delete(convId);
  });

  sessions.set(convId, state);
  return state;
}

export function warmSession(callSid: string): void {
  if (!sessions.has(callSid)) {
    createSession(callSid, () => undefined);
  }
}

export function promoteSession(callSid: string, convId: string, getCallSid: () => string | undefined): void {
  const state = sessions.get(callSid);
  if (!state) return;
  state.getCallSid = getCallSid;
  sessions.delete(callSid);
  sessions.set(convId, state);
  console.log(`[${convId}] Session promoted from callSid ${callSid}`);
}

// ── OpenAI event handler ───────────────────────────────────────────────────────

async function handleOpenAIEvent(
  convId: string,
  state: ConversationState,
  event: Record<string, unknown>,
): Promise<void> {

  if (event.type === "response.output_text.delta") {
    if (state.stream) pushToken(state.stream, event.delta as string);

  } else if (event.type === "response.output_text.done") {
    state.input.push({ role: "assistant", content: event.text as string });
    console.log(`[${convId}] full response: ${event.text}`);

  } else if (event.type === "response.output_item.added") {
    const item = event.item as { type: string; id: string; name?: string; call_id?: string } | undefined;
    if (item?.type === "function_call" && item.id) {
      state.functionCalls.set(item.id, { name: item.name ?? "", args: "", callId: item.call_id ?? "" });
    }

  } else if (event.type === "response.function_call_arguments.delta") {
    const fc = state.functionCalls.get(event.item_id as string);
    if (fc) fc.args += (event.delta as string) ?? "";

  } else if (event.type === "response.function_call_arguments.done") {
    const fc = state.functionCalls.get(event.item_id as string);
    if (!fc) return;
    state.functionCalls.delete(event.item_id as string);

    let result: string;
    if (fc.name === "end_call") {
      const callSid = state.getCallSid();
      if (callSid) {
        try { await twilioClient.calls(callSid).update({ status: "completed" }); result = "Call terminated."; }
        catch (err) { result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }
      } else {
        result = JSON.stringify({ error: "No active call SID found." });
      }
    } else {
      try { result = await executeTool(fc.name, JSON.parse(fc.args || "{}")); }
      catch (err) { result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }
    }

    console.log(`[${convId}] tool ${fc.name} → ${result.slice(0, 80)}`);

    // tool result continues the current in-flight response — send directly, don't re-queue
    wsSend(state, {
      type: "response.create",
      model: "gpt-5.4-nano",
      reasoning: { effort: "none" },
      input: [{ type: "function_call_output", call_id: fc.callId, output: result }],
      tools,
    });

  } else if (event.type === "response.completed") {
    type OutputItem = { type: string };
    const response = event.response as { output?: OutputItem[] } | undefined;
    const hasFunctionCall = response?.output?.some((o) => o.type === "function_call");
    if (!hasFunctionCall) {
      if (state.stream) { finishStream(state.stream); state.stream = null; }
      state.busy = false;
      dispatchNext(convId, state);
    }

  } else if (event.type === "error") {
    console.error(`[${convId}] OpenAI error:`, JSON.stringify(event));
    const err = new Error((event.message as string) ?? JSON.stringify(event));
    if (state.stream) { errorStream(state.stream, err); state.stream = null; }
    state.busy = false;
    dispatchNext(convId, state);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function handleMessage(
  convId: string,
  message: string,
  memory: TACMemoryResponse | undefined,
  session: ConversationSession,
  getCallSid: () => string | undefined,
): AsyncGenerator<string> {
  const systemPrompt = MemoryPromptBuilder.compose(SYSTEM_INSTRUCTIONS, memory, session);

  let state = sessions.get(convId);
  if (!state) {
    state = createSession(convId, getCallSid, systemPrompt);
  } else if (state.input.length === 0) {
    state.input.push({ role: "system", content: systemPrompt });
  }

  state.input.push({ role: "user", content: message });

  const ctrl: StreamController = { tokenQueue: [], notify: null, finished: false, error: null };

  state.requestQueue.push({
    ctrl,
    payload: {
      type: "response.create",
      model: "gpt-5.4-nano",
      reasoning: { effort: "none" },
      input: [...state.input],
      tools,
    },
  });

  dispatchNext(convId, state);
  return drainStream(ctrl);
}

export function clearConversation(convId: string): void {
  const state = sessions.get(convId);
  if (state) {
    if (state.ws.readyState === WebSocket.OPEN) state.ws.close();
    sessions.delete(convId);
  }
}
