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

---

## Setup

### 1. Phone numbers

Open the [Twilio Console](https://console.twilio.com) and go to **Products & Services → Numbers & Senders → Overview**, then click **Set up a new phone number**.

You need two numbers, both with the **Voice** channel enabled:

- **Outbound number** (`TWILIO_PHONE_NUMBER`) — the Twilio number the system calls *from*
- **Destination** (`SIP_PHONE_ADDRESS`) — where the call is delivered:
  - **Testing**: any E.164 number you own (e.g. `+14155551234`)
  - **Production / event booth**: a SIP URI pointing to the physical phone (e.g. `sip:booth@your-pbx.example.com`)

### 2. Twilio cloud services

All steps below are in the [Twilio Console](https://console.twilio.com). Note the SIDs as you go — you'll need them in `.env`.

**API Key**

Go to **Develop → API Keys & Creds → API Keys & Auth Tokens** and click **Create API key**. Give it a name (e.g. `tac-voice`).

Save the Key SID (`SK...`) as `TWILIO_API_KEY` and the secret as `TWILIO_API_SECRET`.

**Sync Service**

Go to **Develop → Sync → Services** and click **Create new Sync Service**. Give it a name (e.g. `tac-voice`).

Save the Service SID (`IS...`) as `TWILIO_SYNC_SERVICE_SID`.

**Conversation Intelligence**

Go to **Products & Services → Conversation Intelligence → Intelligence Configurations** and click **Create Intelligence Configuration**. Follow these steps:

1. **Conversation configuration** — click **Create Conversation configuration** ([docs](https://www.twilio.com/docs/conversations/intelligence/create-intelligence-configuration)):
   - Give it a name (e.g. `tac-voice-conv`)
   - Group by: **Address**
   - Messaging/Chat traffic: leave empty
   - Ingestion: **Capture automatically (passive ingestion)**
   - Voice number: select your outbound Twilio number
   - Conversation lifecycle: **Basic**
   - Closed timeout: **On hangup**
   - Memory store: create a new one when prompted (give it a name, e.g. `tac-voice-mem`), then select it
   - Turn on **Observations and summaries**
   - Click **Create Conversation configuration**

2. **Intelligence configuration** — back on the main page, click **Create Intelligence configuration**:
   - Give it a name (e.g. `tac-voice-intel`)
   - Select the Conversation configuration you just created
   - Click **Submit**

3. **Rule** — click **Create rule**, then:
   - Select **Sentiment** and **Summary**, click **Next**
   - Set both rule parameters to **Automatic**, click **Next**
   - Trigger: **At conversation end**
   - Action webhook: Add the URL to your local dev enviroment or the prod deployment https://tac-demo.com/intelligence-results with HTTP POST 
   - Click **Next**
   - On the **Add context** page, enable **Conversation Memory**
   - Click **Next**, review the summary, click **Create rule**

4. Once all three steps show as completed, click **Go to Intelligence configurations**. Find the entry you created and copy its SID (pattern: `intelligence_configuration_000aaabbb111`) — save it as `TWILIO_TAC_CI_CONFIGURATION_ID`.

5. **Conversation configuration SID** — go to **Products & Services → Conversation Orchestrator → Conversation Configurations**. Find the configuration created in step 1 and copy its SID (pattern: `conv_configuration_000aaabbb111`) — save it as `TWILIO_CONVERSATION_CONFIGURATION_ID`.

### 3. Local development

Install dependencies and copy the env file:

```bash
pnpm install
cp .env.example .env
```

ngrok must be running before starting the server — Twilio needs a public HTTPS URL to send webhooks to your local machine:

```bash
ngrok http 8000
```

Copy the `https://` URL ngrok prints and set it as `NGROK_BASE_URL` in `.env`. Then fill in the remaining values from the steps above and start the server:

```bash
pnpm dev
```

The booth UI is at [http://localhost:8000](http://localhost:8000).

### 4. Production deployment

Deploy to any platform that provides a public HTTPS URL (Fly.io, Railway, Render, Cloud Run, etc.). Set the following environment variables in your hosting platform instead of a `.env` file:

| Variable | Value |
|----------|-------|
| `TWILIO_ACCOUNT_SID` | Your account SID (`AC...`) |
| `TWILIO_API_KEY` | API key SID (`SK...`) |
| `TWILIO_API_SECRET` | API key secret |
| `TWILIO_PHONE_NUMBER` | Your Twilio outbound number |
| `TWILIO_SYNC_SERVICE_SID` | Sync service SID (`IS...`) |
| `TWILIO_CONVERSATION_CONFIGURATION_ID` | Conversation Intelligence config SID |
| `TWILIO_TAC_CI_CONFIGURATION_ID` | TAC CI config SID |
| `SIP_PHONE_ADDRESS` | SIP URI for the booth phone |
| `OPENAI_API_KEY` | OpenAI API key |
| `STATS_USER` / `STATS_PASS` | Basic auth for the `/stats` dashboard |

Start command: `pnpm start`

## Attract mode

Attract mode is designed for unattended event booths. When no one is interacting with the screen, a popup appears after a random idle period inviting passers-by to pick up the phone. As soon as the physical phone is answered, the popup closes and the browser navigates to the live call view.

Enable it by setting environment variables before starting the server:

| Variable | Effect |
|----------|--------|
| `ATTRACT_MODE=true` | Popup fires after a random 5–10 minute idle interval, then repeats |
| `ATTRACT_DEV=true` | Popup fires once after 20 seconds — useful for testing the flow without waiting |

Any interaction with the page (mouse move, keypress, touch) resets the idle timer.

## Agent tools

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

