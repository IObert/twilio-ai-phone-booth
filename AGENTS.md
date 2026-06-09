# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AI voice agent swag booth experience. All application code is in the `app/` directory:

- **app/server.ts** — Fastify server, TAC (Twilio Agent Connect) init, webhook endpoints
- **app/agent.ts** — OpenAI Responses API WebSocket, session state, tool execution
- **app/frontend.ts** — API routes, Sync token generation, Cintel callbacks, admin dashboards
- **app/sync.ts** — Twilio Sync operations (inventory, orders, call tracking) with default inventory
- **app/config.ts** — Agent persona, system prompts, model settings, UI configuration
- **app/public/** — Static HTML pages: `start.html`, `call.html`, `summary.html`, `stats.html` (analytics), `swag.html` (inventory/orders dashboard)
- **scripts/** — Backup and cleanup utilities for Sync data
- **tests/** — Node.js test suite using `node:test` framework

TypeScript, ES modules (`"type": "module"` in package.json). Run with `ts-node`.

## Development commands

```bash
npm install           # install dependencies
npm run dev           # run dev server (ts-node --esm app/server.ts)
npm start             # run prod server (ts-node app/server.ts)
npm test              # run all tests
npm run backup        # backup Sync data to JSON
npm run cleanup       # preview cleanup (dry run)
```

## Running locally

ngrok must be running before starting the server — Twilio needs a public URL to deliver webhooks:

```bash
npm install
cp .env.example .env   # fill in secrets
ngrok http 8000        # copy the https URL into NGROK_BASE_URL in .env
npm run dev            # ts-node --esm app/server.ts
```

The UI is at `http://localhost:8000`. `SIP_PHONE_ADDRESS` accepts any E.164 phone number or SIP URI.

## Setup requirements

See README.md for full setup steps. Required Twilio services:
- Two phone numbers (outbound caller and destination)
- API Key (for SDK authentication)
- Sync Service (shared state between backend and browser)
- Conversation Intelligence configuration (sentiment analysis and summaries post-call)

Optional:
- `TWILIO_TAC_KNOWLEDGE_BASE_ID` — enables Twilio product knowledge search via function calling
- `ENABLE_MIXOLOGIST=true` — enables physical order fulfillment backend integration

## Key design decisions

- **OpenAI Responses API** (not Chat Completions): streaming WebSocket for low-latency voice. The WebSocket is pre-warmed before a call starts.
- **Twilio Sync** is the single source of truth. Inventory stored in Sync Document, orders/calls in Sync Map with 4-hour TTL (auto-cleanup).
- **Function calling** drives side effects: `submit_swag_order`, `complete_swag_question`, `complete_twilio_question`, `end_call`. Tools call back to `frontend.ts` routes.
- **Conversation Intelligence** runs automatically after call ends to capture sentiment and generate summaries. Results arrive via webhook at `/intelligence-results`.
- **Inventory management**: Real-time validation on every order. Disabled items are filtered from agent instructions AND validated server-side (two-layer protection).
- Responses kept short (1–2 sentences) for phone calls — no markdown, no lists, plain spoken sentences only.

## Agent behavior

The agent is "Olivia," the AI Swagkeeper for The AI Summit London 2026. System prompt defined in `buildSystemInstructions()` in `app/config.ts`:

**Three tasks (none are mandatory — caller drives the interaction):**
1. **Twilio product questions** — answers questions about Twilio APIs, features, pricing using knowledge base search (if configured). Calls `complete_twilio_question` after answering.
2. **Swag question** — answers questions about available items, sizes, colors. Calls `complete_swag_question` after answering.
3. **Swag order** — takes ONE order per call (enforced). Available items loaded dynamically from Sync inventory. Only T-Shirts have sizes (2XL, XL, L, M). Calls `submit_swag_order` and reads back order number.

**Inventory is dynamic**: Disabled items are NOT included in agent instructions and are rejected server-side. This ensures real-time inventory control from the `/swag` dashboard.

**One-item-per-call limit**: Enforced in `submit_swag_order` tool. If caller tries to order again, agent politely explains the limit.

## Current inventory items

Default items (see `getDefaultInventory()` in `app/sync.ts`):
- Red Notebook, Pen, Tic Tac Toe, Sling Bag, Phone Strap, Red Socks, Sport Socks, T-Shirt (has sizes: 2XL, XL, L, M), Cable Tidy

Inventory can be managed via `/swag` dashboard (requires `STATS_USER`/`STATS_PASS` auth).

## AI model

Model is set in `MODEL_CONFIG.model` in `app/config.ts`. Current value: `gpt-5.4-nano` (intentional — do not change unless explicitly requested).

## Environment variables

All required variables are in `.env.example`. Key ones:

- `NGROK_BASE_URL` — must be set for Twilio webhooks (local dev) or your public URL (production)
- `TWILIO_SYNC_SERVICE_SID` — shared between backend and browser Sync client
- `TWILIO_API_KEY` / `TWILIO_API_SECRET` — used to mint Sync tokens for the browser
- `TWILIO_CONVERSATION_CONFIGURATION_ID` / `TWILIO_TAC_CI_CONFIGURATION_ID` — Conversation Intelligence configs
- `TWILIO_TAC_KNOWLEDGE_BASE_ID` — optional, enables Twilio product knowledge search
- `STATS_USER` / `STATS_PASS` — basic auth for `/stats` and `/swag` dashboards
- `ATTRACT_MODE=true` — enables idle popup for event booth (random 5–10 min intervals)
- `ATTRACT_DEV=true` — dev shortcut: fires popup once after 20 seconds

## Common tasks

**Change system prompt or agent behavior:**
Edit `buildSystemInstructions()` in `app/config.ts`. Keep responses short — this is a phone call.

**Add/modify inventory items:**
1. Edit `getDefaultInventory()` in `app/sync.ts` for default structure
2. Or use `/swag` dashboard to enable/disable items, edit stock, add sizes

**Add a new agent tool:**
1. Add tool schema to `TOOLS` array in `app/config.ts`
2. Add execution handler in `executeTool()` in `app/agent.ts`
3. If needs backend route, add in `app/frontend.ts` under `/api/beans/`

**Reset inventory to defaults:**
Use "Reset to Default" button in `/swag` dashboard, or call `POST /api/inventory/reset`

**Run tests:**
```bash
npm test                  # run all tests
npm run test:inventory    # inventory validation only
npm run test:disabled     # disabled items protection only
```

**Backup/cleanup Sync data:**
```bash
npm run backup    # export to backups/ folder (read-only, safe)
npm run cleanup   # dry run preview (edit OPTIONS in script to actually delete)
```

## What to avoid

- Do not add session persistence outside Twilio Sync — it is the single source of truth.
- Do not hardcode inventory items in agent instructions — they must be loaded dynamically from Sync.
- Do not skip server-side validation for orders — disabled items must be rejected even if agent offers them.
- Do not make AI responses longer or add markdown — responses go to phone callers.
- Do not remove WebSocket pre-warming logic in `app/agent.ts` — intentional for latency.
- Do not bypass basic auth on `/stats` or `/swag` routes — they must remain protected.
