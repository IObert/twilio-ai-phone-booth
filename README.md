# Twilio AI Phone Booth (TAC Edition)

An AI voice agent for phone calls powered by [Twilio Agent Connect (TAC)](https://www.twilio.com/docs/agent-connect), OpenAI, and Twilio Conversation Intelligence. First built as a conference booth experience for **Twilio SIGNAL World Tour Berlin 2026**, where attendees could call a physical phone and chat with "Olivia," an AI barista at the Twilio Cafe.

## What it does

- Initiates outbound calls to any phone number or SIP address
- Connects the caller to an AI agent (OpenAI Responses API via WebSocket) through Twilio Agent Connect
- The AI agent can answer coffee questions, take orders, and end the call using function calling
- Tracks every call in Twilio Sync for real-time frontend updates
- Runs Conversation Intelligence to capture sentiment and summaries post-call
- Exposes a protected stats dashboard at `/stats`

## Architecture

| File | Responsibility |
|------|----------------|
| [server.ts](server.ts) | Fastify HTTP/WebSocket server, TAC initialization, static file serving |
| [agent.ts](agent.ts) | OpenAI Responses API streaming, session state, tool execution |
| [frontend.ts](frontend.ts) | API routes, Sync token generation, Conversation Intelligence callback, stats dashboard |
| [public/](public/) | Static HTML pages for the booth UI |

## Prerequisites

- Node.js 20+
- pnpm (or npm)
- A Twilio account with:
  - A phone number
  - Agent Connect configured
  - Sync service
  - Conversation Intelligence profile
  - API Key + Secret
- An OpenAI API key
- [ngrok](https://ngrok.com) (required for local development — Twilio must reach your server)

## Setup

```bash
pnpm install
cp .env.example .env
# fill in .env (see Environment Variables below)
```

ngrok is required before starting the server — Twilio needs a public URL to reach your local machine. Start it first, then set the URL in `.env`:

```bash
ngrok http 8000
# copy the https URL into NGROK_BASE_URL in .env
pnpm dev
```

The interface is then available at [http://localhost:8000](http://localhost:8000).

## Environment Variables

Copy [.env.example](.env.example) and fill in the values.

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (`AC...`) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio number to call from |
| `TWILIO_CONVERSATION_CONFIGURATION_ID` | Conversation Intelligence configuration SID (`conv_...`) |
| `TWILIO_TAC_CI_CONFIGURATION_ID` | TAC Conversation Intelligence config SID |
| `TWILIO_SYNC_SERVICE_SID` | Sync service SID (`IS...`) |
| `TWILIO_API_KEY` | Twilio API key (`SK...`) |
| `TWILIO_API_SECRET` | Twilio API secret |
| `SIP_PHONE_ADDRESS` | Phone number or SIP address to call (e.g. `+14155551234` or a SIP URI) |
| `NGROK_BASE_URL` | Public base URL used in Twilio webhook callbacks |
| `OPENAI_API_KEY` | OpenAI API key |
| `MIXOLOGIST_BASE_URL` | (Optional) Backend URL for order fulfillment |
| `SEGMENT_WRITE_KEY` | Segment write key for analytics |
| `STATS_USER` | Username for the `/stats` dashboard |
| `STATS_PASS` | Password for the `/stats` dashboard |
| `TWILIO_LOG_LEVEL` | Twilio SDK log level (e.g. `error`) |

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/start` | Booth entry page |
| GET | `/call` | Live call interface |
| GET | `/summary` | Post-call summary |
| GET | `/stats` | Protected analytics dashboard |
| GET | `/health` | Health check |
| POST | `/api/startBoothCall` | Initiate an outbound call |
| POST | `/api/getSyncToken` | Get a Twilio Sync JWT for the browser |
| POST | `/api/getVIToken` | Get a Conversation Intelligence token |
| POST | `/api/callStatus` | Twilio call status webhook |
| POST | `/api/beans/order` | Order submission callback (called by AI) |
| POST | `/api/beans/coffeeQuestions` | Coffee Q&A callback (called by AI) |
| POST | `/cintel-callback` | Conversation Intelligence results webhook |

## Agent tools

The AI agent has access to three OpenAI function tools:

| Tool | What it does |
|------|-------------|
| `complete_coffee_question` | Logs an answered coffee question to the backend |
| `submit_order` | Places a coffee order and returns an order number |
| `end_call` | Hangs up the call via Twilio |

## Stats dashboard

Navigate to `/stats` and authenticate with `STATS_USER` / `STATS_PASS`. The dashboard shows:

- Total calls and completion rate
- Order placement rate and question answering rate
- Average messages per call and call duration
- Sentiment breakdown (positive / neutral / negative / unknown)

## Scripts

```bash
pnpm start    # ts-node server.ts
pnpm dev      # ts-node --esm server.ts
```
