import { config } from "dotenv";
import WebSocket from "ws";
import twilio from "twilio";
import { MemoryPromptBuilder } from "twilio-agent-connect";
import type { ConversationSession, TACMemoryResponse } from "twilio-agent-connect";

config();

const twilioClient = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: process.env.TWILIO_ACCOUNT_SID });
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const BASE_URL = `http://localhost:${process.env.PORT ?? 8000}/api/beans`;

async function appendSyncHistory(callSid: string, role: "user" | "ai", text: string): Promise<void> {
  const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const item = await twilioClient.sync.v1.services(syncServiceSid)
    .syncMaps("callTracker").syncMapItems(callSid).fetch();
  const current = item.data as { status: string; tasks: object; history: { role: string; text: string }[] };
  await twilioClient.sync.v1.services(syncServiceSid)
    .syncMaps("callTracker").syncMapItems(callSid).update({
      data: { ...current, history: [...current.history, { role, text }] },
      ttl: 14400,
    });
}

export const WELCOME_GREETING = "Welcome to Signal Berlin! I'm Olivia. We've got two things to do together: a quick guessing game where you name a SIGNAL World Tour city, and I can answer your coffee questions. Want to start with the guessing game?";

const SYSTEM_INSTRUCTIONS = `You are Olivia, a friendly AI barista at Twilio Cafe during Twilio SIGNAL World Tour Berlin 2026. You are talking to customers over the phone.

CRITICAL — PHONE CALL RULES:
- Never use markdown, bullet points, headers, or lists. Plain spoken sentences only.
- Keep every response short — 1 to 2 sentences maximum. This is a phone call, not a chat.
- No filler phrases like "Great choice!" or "Absolutely!". Get to the point.

You help customers with two mandatory tasks and one optional one:

MANDATORY — SIGNAL World Tour guessing game: Ask the customer to guess at least one other SIGNAL World Tour stop (they're already in Berlin, so that one doesn't count). The full list is: San Francisco, São Paulo, Mexico City, London, Paris, Singapore, Tokyo, Sydney, and Berlin. As soon as they name at least one correct city, the task is complete — celebrate it and move on. If they want to keep guessing more, let them, but never make them feel they need to name all cities. After they're done guessing, briefly share how many they got and call complete_world_tour_guess. You know all about the SIGNAL World Tour — answer any questions the customer has about it.

MANDATORY — Coffee question: Answer any question the customer has about coffee — types, brewing methods, menu items, preferences. After answering, call complete_coffee_question.

OPTIONAL — Coffee order: If the customer wants to order, great. Menu: Espresso, Cortado, Cappuccino, Flat White, Americano, Matcha Latte, Cold Brew, Iced Matcha, Iced Latte. Oat milk and organic dairy milk available. Once confirmed, call submit_order and read back the order number. Never push the customer to order if they haven't brought it up.

For anything about Twilio products or pricing, tell them to ask at the booth.

Keep personal details the customer shares in mind — name, preferences — for a more personal experience next time.`;

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
          enum: ["Espresso", "Cortado", "Cappuccino", "Flat White", "Americano", "Matcha Latte", "Cold Brew", "Iced Matcha", "Iced Latte"],
        },
        modifiers: { type: "array", items: { type: "string", enum: ["Milk", "Oat Milk"] } },
      },
      required: ["originalMessage", "item", "modifiers"],
    },
  },
  {
    type: "function",
    name: "complete_world_tour_guess",
    description: "Marks the SIGNAL World Tour guessing game as complete after the customer has made their guesses.",
    parameters: {
      type: "object",
      properties: { citiesGuessed: { type: "number" } },
      required: ["citiesGuessed"],
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
  complete_world_tour_guess: `${BASE_URL}/worldTourGuess`,
};

async function executeTool(name: string, args: unknown, callSid: string | undefined): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callSid) headers["x-call-sid"] = callSid;
  const res = await fetch(TOOL_URLS[name], {
    method: "POST",
    headers,
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
  input: Array<Record<string, unknown>>;
  busy: boolean;                // true while a response.create is in flight
  requestQueue: PendingRequest[]; // serialized user requests
  stream: StreamController | null;
  functionCalls: Map<string, { name: string; args: string; callId: string; itemId: string }>;
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
    const callSid = state.getCallSid();
    if (callSid) {
      appendSyncHistory(callSid, "ai", event.text as string)
        .catch((err: unknown) => console.error(`[${convId}] appendSyncHistory failed:`, err));
    }

  } else if (event.type === "response.output_item.added") {
    const item = event.item as { type: string; id: string; name?: string; call_id?: string } | undefined;
    if (item?.type === "function_call" && item.id) {
      state.functionCalls.set(item.id, { name: item.name ?? "", args: "", callId: item.call_id ?? "", itemId: item.id });
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
      try { result = await executeTool(fc.name, JSON.parse(fc.args || "{}"), state.getCallSid()); }
      catch (err) { result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }
    }

    // The Responses API is stateless: the follow-up must include the full history
    // *including* the function_call item itself, otherwise OpenAI can't match the call_id.
    state.input.push({ type: "function_call", id: fc.itemId, call_id: fc.callId, name: fc.name, arguments: fc.args || "{}" });
    state.input.push({ type: "function_call_output", call_id: fc.callId, output: result });

    wsSend(state, {
      type: "response.create",
      model: "gpt-5.4-nano",
      reasoning: { effort: "none" },
      input: [...state.input],
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

  const sid = state.getCallSid();
  if (sid) appendSyncHistory(sid, "user", message).catch((err: unknown) => console.error(`[${convId}] appendSyncHistory user failed:`, err));
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
