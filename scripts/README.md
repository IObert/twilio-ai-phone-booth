# Scripts

Utility scripts for managing Twilio Sync data.

## Quick Start

```bash
npm run backup    # Export Sync data to backups/ folder
npm run cleanup   # Dry run - preview what would be deleted

# Or run directly:
ts-node scripts/backup-sync.ts
ts-node scripts/cleanup-orders.ts
```

## Scripts

**backup-sync.ts** - Export all Sync data to JSON files  
Creates: `backups/orders-YYYY-MM-DD.json`, `backups/inventory-YYYY-MM-DD.json`, `backups/order-counter-YYYY-MM-DD.json`

**cleanup-orders.ts** - Delete old orders from Sync to manage costs  
Dry run by default. Edit `OPTIONS` in file to actually delete.

## Configuration (cleanup-orders.ts)

```typescript
const OPTIONS = {
  ACTUALLY_DELETE: false,        // Must set true to delete
  DELETE_ALL: false,             // Delete everything
  DELETE_COMPLETED_ONLY: true,   // Only completed orders
  DELETE_OLDER_THAN_DAYS: 30,    // Orders older than N days
  BACKUP_BEFORE_DELETE: true,    // Create backup first
};
```

**Common scenarios:**
- End of event: `{ ACTUALLY_DELETE: true, DELETE_ALL: true, BACKUP_BEFORE_DELETE: true }`
- Monthly cleanup: `{ ACTUALLY_DELETE: true, DELETE_OLDER_THAN_DAYS: 90, BACKUP_BEFORE_DELETE: true }`

## Requirements

Env vars: `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_SYNC_SERVICE_SID`

## Safety

**backup-sync.ts** - ✅ Read-only, safe to run anytime  
**cleanup-orders.ts** - ⚠️ Destructive, dry run by default, always review before enabling `ACTUALLY_DELETE`

## Cost Management

Sync costs $0.01/object/month. 1000 orders = ~$10/month. Items auto-expire after 365 days.
