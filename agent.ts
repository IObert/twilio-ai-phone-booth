import { config } from "dotenv";
import WebSocket from "ws";
import twilio from "twilio";
import { MemoryPromptBuilder, KnowledgeClient, createKnowledgeTools } from "twilio-agent-connect";
import type { ConversationSession, TACMemoryResponse } from "twilio-agent-connect";
import { updateCallTracker } from "./sync.ts";


config();

const twilioClient = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: process.env.TWILIO_ACCOUNT_SID });
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const BASE_URL = `http://localhost:${process.env.PORT ?? 8000}/api/beans`;

let knowledgeSearchImpl: ((args: { query: string }) => Promise<unknown>) | null = null;
let knowledgeToolName: string | null = null;

const knowledgeBaseId = process.env.TWILIO_TAC_KNOWLEDGE_BASE_ID;
if (knowledgeBaseId) {
  const kbClient = new KnowledgeClient(
    { apiKey: process.env.TWILIO_API_KEY!, apiSecret: process.env.TWILIO_API_SECRET! } as any,
    undefined as any,
  );
  const tacTool = await createKnowledgeTools(kbClient).forKnowledgeBaseAsync(knowledgeBaseId);
  knowledgeToolName = tacTool.name;
  knowledgeSearchImpl = tacTool.implementation as (args: { query: string }) => Promise<unknown>;
}

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

export const WELCOME_GREETING = "Welcome to Twilio SIGNAL Berlin! I'm Olivia. I can tell you all about Guinness pint prices across the UK, or help you with a coffee question. What's on your mind?";

const SYSTEM_INSTRUCTIONS = `You are Olivia, a friendly AI barista at Twilio Cafe during Twilio SIGNAL World Tour Berlin 2026. You are talking to customers over the phone.

CRITICAL — PHONE CALL RULES:
- Never use markdown, bullet points, headers, or lists. Plain spoken sentences only.
- Keep every response short — 1 to 2 sentences maximum. This is a phone call, not a chat.
- No filler phrases like "Great choice!" or "Absolutely!". Get to the point.

You can help customers with two things — a Guinndex pint price question and a coffee question — plus optionally take a coffee order. Do not push them to do any of these. If someone seems unsure what to do, you can gently mention they can ask about Guinness pint prices across the UK, ask a coffee question, or order a coffee.

GUINNDEX PINT PRICES: The Guinndex (guinndex.co.uk) is an AI-powered survey of Guinness pint prices across UK pubs, covering over 6,700 pubs in England, Scotland, Wales, and Northern Ireland. If someone asks what the Guinndex is, explain this briefly in one sentence. You can answer questions about pint prices — cheapest, dearest, average, biggest price gaps, and comparisons between places. If someone asks about a country or region outside the UK, let them know the Guinndex currently only covers the UK. After answering a Guinndex question, call complete_guindex_question.

COFFEE QUESTION: Answer any question the customer has about coffee — types, brewing methods, menu items, preferences. After answering, call complete_coffee_question.

COFFEE ORDER (optional): If the customer wants to order, great. Menu: Espresso, Cortado, Cappuccino, Flat White, Americano, Matcha Latte, Cold Brew, Iced Matcha, Iced Latte. Oat milk and organic dairy milk available. Once confirmed, call submit_order and read back the order number. Never push the customer to order.

For anything about Twilio products or pricing, tell them to ask at the Twilio booth.

Keep personal details the customer shares in mind — name, preferences — for a more personal experience.`;

const tools: object[] = [
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
    name: "complete_guindex_question",
    description: "Marks the Guinndex pint price question as complete after answering a customer's question about Guinness pint prices in UK pubs.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "Terminates the current phone call. Call this when the user asks to hang up or says goodbye.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

if (knowledgeSearchImpl && knowledgeToolName) {
  tools.push({
    type: "function",
    name: knowledgeToolName,
    description: "Search the Guinndex knowledge base for Guinness pint price data. Use this to answer any question about pub prices, cheapest or dearest pints, price gaps, or averages in a given UK area or town.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  });
}

const TOOL_URLS: Record<string, string> = {
  complete_coffee_question: `${BASE_URL}/coffeeQuestions`,
  submit_order: `${BASE_URL}/order`,
  complete_guindex_question: `${BASE_URL}/guindexQuestion`,
};

async function executeTool(name: string, args: unknown, callSid: string | undefined): Promise<string> {
  if (name === knowledgeToolName && knowledgeSearchImpl) {
    const result = await knowledgeSearchImpl(args as { query: string });
    return JSON.stringify(result);
  }
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
  pendingEndCall: boolean;
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
    pendingEndCall: false,
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
      state.pendingEndCall = true;
      result = "Farewell message queued. Say a brief goodbye to the caller now.";
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
      if (state.pendingEndCall) {
        state.pendingEndCall = false;
        const callSid = state.getCallSid();
        if (callSid) {
          // Delay to allow TTS playback of the farewell before hanging up
          setTimeout(() => {
            twilioClient.calls(callSid).update({ status: "completed" })
              .catch((err: unknown) => console.error(`[${convId}] end_call hangup failed:`, err));
          }, 3000);
        }
      } else {
        dispatchNext(convId, state);
      }
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

function extractMemoryLists(memory: TACMemoryResponse | undefined): { observations: string[]; summaries: string[] } {
  if (!memory) return { observations: [], summaries: [] };
  const data = (memory as any)._data;
  if (!data) return { observations: [], summaries: [] };

  // _data can be an array (older format) or an object { observations, summaries, communications }
  if (Array.isArray(data)) return { observations: [], summaries: [] };

  const observations: string[] = (data.observations ?? []).map((o: any) => o?.content ?? o?.text ?? String(o)).filter(Boolean);
  const summaries: string[] = (data.summaries ?? []).map((s: any) => s?.content ?? s?.text ?? String(s)).filter(Boolean);
  return { observations, summaries };
}

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
  if (sid) {
    appendSyncHistory(sid, "user", message).catch((err: unknown) => console.error(`[${convId}] appendSyncHistory user failed:`, err));
    const { observations, summaries } = extractMemoryLists(memory);
    if (observations.length || summaries.length) {
      updateCallTracker(sid, { observations, summaries }).catch((err: unknown) => console.error(`[${convId}] updateMemory failed:`, err));
    }
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
