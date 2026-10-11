# ThreadLine API reference

All routes live under `/api` and return JSON. They are called by the web app with the
session cookie set at sign-in; there are no separate API keys.

## Conventions

- **Auth**: `401` when signed out, `403` when the role isn't allowed. Roles: `owner`,
  `storekeeper`, `floor_supervisor` (floor), `qc_inspector` (QC).
- **Validation errors**: `400` with `{ "fieldErrors": { "field": ["message"] } }`.
- **Conflicts**: `409` when a business rule refuses the write (already dispatched, in use, locked month, ...).
- **Pagination** (opt-in): pass `page` (and `pageSize`, max 200) to get `{ <items>, total, page, pageSize }`.
  Without `page`, a route returns its original unpaged shape.
- **Idempotency**: payments, QC inspections and dispatches accept `clientMutationId`; a repeat returns the recorded result.
- **Realtime**: writes emit Socket.IO events (`/api/socketio`) after commit.

## Routes

| Route | Methods | Roles | Notes |
|---|---|---|---|
| `/api/auth/login`, `/api/auth/logout` | POST | public | Session cookie |
| `/api/health` | GET | public | `db`, `groq`, `whatsapp` readiness |
| `/api/track/[token]` | GET | public | Buyer tracking for one order |
| `/api/webhooks/whatsapp` | GET POST | Meta (signed) | Verification and delivery receipts |
| `/api/me`, `/api/me/preferences`, `/api/me/password`, `/api/me/sessions`, `/api/me/activity` | GET PATCH POST DELETE | any signed-in | Profile, preferences, password, devices, own activity |
| `/api/orders` | GET POST | owner | `q`, `status`, `buyerId`, `sort`, paging; `view=options` for pickers |
| `/api/orders/[id]` | GET PATCH DELETE | owner | Delete only without history |
| `/api/orders/feasibility` | POST | owner | Yarn and machine capacity vs deadline |
| `/api/orders/[id]/reserve-yarn`, `/api/orders/[id]/reservations/[reservationId]` | POST DELETE | owner, storekeeper | Reserve / release yarn |
| `/api/buyers`, `/api/buyers/[id]` | GET POST PATCH DELETE | owner | Archive instead of delete when in use |
| `/api/suppliers`, `/api/yarn-types`, `/api/yarn-lots` (and `/[id]`) | GET POST PATCH DELETE | owner, storekeeper | Inventory masters and intake |
| `/api/yarn/low-stock` | GET | owner, storekeeper | |
| `/api/purchase-requests` (and `/[id]`) | GET POST / PATCH | owner, storekeeper; owner decides | |
| `/api/machines` (and `/[id]`, `/[id]/status`) | GET POST PATCH DELETE | owner, floor | Floor board data, delay risks, reorder suggestions |
| `/api/work-orders` (and `/[id]`) | GET POST PATCH DELETE | owner, floor | `page`, `search`, `status` |
| `/api/production-logs` (and `/[id]`) | GET POST PATCH DELETE | owner, floor | Corrections recompute progress |
| `/api/maintenance-requests` (and `/[id]`) | GET POST / PATCH | owner, floor; owner decides | |
| `/api/rolls` | GET POST | owner, floor, QC (GET also storekeeper) | `qcStatus`, `search`, `dispatched`, `orderId`, `machineId`, paging, `withCounts`, `view=dispatch` |
| `/api/rolls/[id]`, `/api/rolls/by-qr/[token]`, `/api/rolls/mint-options` | GET PATCH DELETE | as above | Lineage, QR lookup, mint form options |
| `/api/rolls/[id]/qc` (and `/[recordId]/reversal`) | POST | owner, QC | Inspect / reverse an inspection |
| `/api/dispatches` (and `/[id]`) | GET POST PATCH | owner, storekeeper | Double-dispatch safe; raises the invoice |
| `/api/invoices` (and `/[id]`, `/[id]/reversal`) | GET POST | owner, storekeeper (reversal: owner) | 5% GST, `INV-YYMM-NNNN` |
| `/api/payments` (and `/[id]/reversal`) | GET POST | owner | `month`, `show`, `q`, paging |
| `/api/expenses` (and `/[id]/reversal`) | GET POST | owner | `month`, `category`, `orderId` |
| `/api/workers` (and `/[id]`), `/api/attendance` (and `/[id]`) | GET POST PATCH DELETE | owner | Attendance locks after payout approval |
| `/api/payout-approvals` (and `/[id]`) | GET POST PATCH | owner | |
| `/api/approvals/pending` | GET | owner | Counts for the dashboard banner |
| `/api/ledger` | GET | owner | `orderId`, or `sourceType` and `sourceId` |
| `/api/analytics/cost-per-order`, `/profit-month`, `/machine-output`, `/defects` | GET | owner (machine-output also floor; defects also QC) | |
| `/api/accounts/month-end/export` | GET | owner | CSV |
| `/api/alerts` | GET PATCH | any signed-in | Role-scoped; `unread`, `severity`, `limit`; mark read/unread |
| `/api/alerts/outbox` (and `/process`), `/api/alerts/whatsapp/send` | GET POST | owner (send also storekeeper) | WhatsApp outbox |
| `/api/assistant/query` | POST | owner | Read-only tool-calling assistant |
| `/api/audit` | GET | owner | `entity`, `action`, `userId`, `from`, `to`, `q`, paging |
| `/api/backup`, `/api/restore` | GET POST | owner | Legacy SQLite only (501 on Postgres) |
