# Tests

Test suite using Node's built-in `node:test` framework.

## Quick Start

```bash
npm test                  # Run all tests

# Or run individual test files directly:
node --import ts-node/esm --test tests/test-inventory-validation.ts
node --import ts-node/esm --test tests/test-disabled-items.ts
```

## Test Files

**test-inventory-validation.ts** - Order validation with real-time inventory checks  
Tests: Valid orders, invalid sizes, missing sizes, non-existent items, case-insensitive matching

**test-disabled-items.ts** - Disabled item protection  
Tests: Agent filtering, server validation, two-layer protection

## Requirements

- Server running on `localhost:8000` (or set `NGROK_BASE_URL`)
- Twilio Sync Service with inventory configured
- Env vars: `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_SYNC_SERVICE_SID`

## Troubleshooting

**"ECONNREFUSED"** - Server not running. Start with `npm start`  
**"Document not found"** - Initialize inventory at `http://localhost:8000/swag`  
**"currently unavailable"** - Item disabled in inventory. Enable it in `/swag` dashboard
