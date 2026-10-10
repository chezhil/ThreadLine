# Your task: Module 4 — Accounts, Owner Dashboard & Local AI Assistant
(Agent: Claude — teammate: Devacharan)

You are one of four AI agents building **ThreadLine**, a textile-mill management
system, in parallel. Two files are attached alongside this prompt:
`everest-mill-build-spec.md` (full product spec) and `Textile_Manufacturing_System.pdf`
(problem statement). Read both fully before writing code.

Another agent (Module 1 / Chezhil) is bootstrapping the repo, Prisma schema, shared
libraries (`db.ts`, `auth.ts`, `realtime.ts`, `audit.ts`, `tokens.ts`,
`src/components/ui/*`) and app shell, and pushing it to `main` within the first hour.
**Pull `main` before you start writing code that touches the DB or shared libs.** If
it isn't there yet, start from the schema and folder layout in the shared contract
below — they are final, so you won't be working from a guess. Your module is the
"capstone": most of what you build reads data the other three modules write, so it
naturally comes together in the second half of the build — but build your own
tables and screens in parallel from hour 0, using the fixed schema, rather than
waiting idle.

---

# ThreadLine — Shared Contract (read this block in every agent prompt)

This block is identical in all four agent prompts. It exists so four different AI
agents, working at the same time with no live communication between them, produce
code that merges cleanly. **Do not deviate from it.** If you think something here is
wrong, say so in `AI_NOTES.md` and in your PR description — do not silently change it.

Repo: https://github.com/chezhil/ThreadLine — root of the repo is this `project/`
folder. Attach `everest-mill-build-spec.md` and `Textile_Manufacturing_System.pdf`
(both at the repo root's parent, given to you alongside this prompt) as background —
they are the full product spec and problem statement. This contract is the condensed,
binding subset of that spec for your slice of the work.

## Tech stack (fixed — do not substitute)

- **Next.js 14 (App Router) + TypeScript**, single app, no separate frontend/backend repos.
- **Prisma + SQLite** for the database (file at `prisma/dev.db`), migrations via `prisma migrate dev`.
- **zod** for all validation schemas, shared between client forms and API route handlers (one schema, imported both places — never redefine the same shape twice).
- **Tailwind CSS** + a small shared component library in `src/components/ui/` (Button, Input, Select, Table, Badge, Card, Drawer, EmptyState). Use design tokens below — never hardcode a hex colour or spacing value in a feature file.
- **Socket.io** for realtime (machine status, order status, stock changes, notifications). One server-side emitter module, one client-side hook.
- **next-pwa** (or equivalent) for the service worker / installable app shell.
- Local AI assistant via **Ollama**, called only from the server, never from the client.

## Repo layout and folder ownership

```
project/
  prisma/
    schema.prisma          <- FINAL, below. Whoever pushes first wins; everyone else
                               pulls main before their first DB-touching commit.
                               Never edit an existing model's fields without flagging
                               it in AI_NOTES.md and pinging the team — only add new
                               models/fields additively.
  scripts/seed.ts           <- each module appends its own seed data in its own
                               clearly-commented section; never delete another
                               module's seed block.
  src/
    lib/
      db.ts                 <- shared Prisma client singleton (create once if missing, never duplicate)
      validation/           <- one file per entity, e.g. order.ts, roll.ts — zod schemas
      auth.ts                <- shared session/auth helpers
      realtime.ts            <- shared socket.io emitter ("emit('order:status', ...)")
      audit.ts                <- shared `logAudit(entity, entityId, action, oldValue, newValue, userId)` helper — call this from every mutation, don't write your own
      tokens.ts / globals.css <- design tokens (colours, spacing, radius, font sizes)
    components/ui/          <- shared component library — add to it, don't fork it
    app/
      (auth)/                <- login
      <your-module-route-groups>/   <- see your specific prompt
    app/api/
      <your-module-routes>/  <- see your specific prompt
  prompts/                   <- these prompt files, not app code, ignore at build time
  AI_NOTES.md                <- append your own section, never overwrite someone else's
```

**Hard rule:** only create/edit files inside your own route groups, your own
`app/api/<your-routes>/`, your own section of `scripts/seed.ts`, and your own section
of `AI_NOTES.md`. Only touch `src/lib/*` or `src/components/ui/*` to *add* something
new (a new shared helper, a new shared component) — never rename or change the
signature of something already there without flagging it loudly in your PR
description, because three other people are depending on it.

## Database schema (final — Prisma syntax, SQLite provider)

Implement exactly this. If your module needs a field this doesn't have, add it as a
new optional field in your own migration and note it in `AI_NOTES.md` — don't repurpose
an existing field.

```prisma
model User {
  id           String   @id @default(uuid())
  name         String
  role         String   // owner | storekeeper | floor_supervisor | qc_inspector
  passwordHash String
  createdAt    DateTime @default(now())
}

model Supplier {
  id      String @id @default(uuid())
  name    String
  contact String
  gstin   String?
}

model Buyer {
  id      String @id @default(uuid())
  name    String
  contact String
  gstin   String?
  address String?
}

model YarnType {
  id                 String  @id @default(uuid())
  name               String
  count              String
  material           String
  colour             String
  lowStockThresholdKg Float
  costPerKg          Float
  lots               YarnLot[]
}

model YarnLot {
  id              String    @id @default(uuid())
  yarnTypeId      String
  yarnType        YarnType  @relation(fields: [yarnTypeId], references: [id])
  supplierId      String
  supplier        Supplier  @relation(fields: [supplierId], references: [id])
  lotNo           String
  qtyReceivedKg   Float
  qtyRemainingKg  Float
  receivedAt      DateTime
  linkedOrderId   String?
  reservations    OrderYarnReservation[]
  rolls           Roll[]
}

model Order {
  id               String   @id @default(uuid())
  orderNo          String   @unique   // e.g. EVR-2610-014
  buyerId          String
  buyer            Buyer    @relation(fields: [buyerId], references: [id])
  fabricType       String
  colour           String
  gsm              Int
  qtyMetres        Float
  pricePerMetre    Float
  deadline         DateTime
  status           String   // NEW|CONFIRMED|IN_PRODUCTION|QC|READY|DISPATCHED|CLOSED
  trackingToken    String   @unique
  feasibilityResult String?
  createdAt        DateTime @default(now())
  reservations     OrderYarnReservation[]
  workOrders       WorkOrder[]
  rolls            Roll[]
  invoices         Invoice[]
}

model OrderYarnReservation {
  id        String  @id @default(uuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  yarnLotId String
  yarnLot   YarnLot @relation(fields: [yarnLotId], references: [id])
  qtyKg     Float
}

model Machine {
  id                   String @id @default(uuid())
  name                 String
  type                 String // spinning|loom|dyeing
  status               String // RUNNING|IDLE|BREAKDOWN|MAINTENANCE
  capacityMetresPerShift Float
  workOrders           WorkOrder[]
  productionLogs       ProductionLog[]
  rolls                Roll[]
}

model WorkOrder {
  id          String   @id @default(uuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  stage       String   // spinning|weaving|dyeing
  machineId   String
  machine     Machine  @relation(fields: [machineId], references: [id])
  plannedQty  Float
  producedQty Float    @default(0)
  status      String
  startedAt   DateTime?
  finishedAt  DateTime?
  productionLogs ProductionLog[]
  rolls       Roll[]
}

model ProductionLog {
  id          String   @id @default(uuid())
  workOrderId String
  workOrder   WorkOrder @relation(fields: [workOrderId], references: [id])
  machineId   String
  machine     Machine  @relation(fields: [machineId], references: [id])
  shift       String
  qtyProduced Float
  loggedAt    DateTime @default(now())
  loggedBy    String
}

model Roll {
  id          String   @id @default(uuid())
  rollNo      String   @unique
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  workOrderId String
  workOrder   WorkOrder @relation(fields: [workOrderId], references: [id])
  machineId   String
  machine     Machine  @relation(fields: [machineId], references: [id])
  shift       String
  yarnLotId   String
  yarnLot     YarnLot  @relation(fields: [yarnLotId], references: [id])
  lengthMetres Float
  weightKg    Float
  qcStatus    String   // PENDING|PASS|REWORK|REJECT
  dispatchId  String?
  dispatch    Dispatch? @relation(fields: [dispatchId], references: [id])
  qrToken     String   @unique
  qcRecords   QCRecord[]
}

model QCRecord {
  id           String   @id @default(uuid())
  rollId       String
  roll         Roll     @relation(fields: [rollId], references: [id])
  inspectorId  String
  result       String   // PASS|REWORK|REJECT
  defects      String   // JSON-encoded string array: hole|colour_mismatch|uneven_weave
  notes        String?
  inspectedAt  DateTime @default(now())
}

model Dispatch {
  id           String   @id @default(uuid())
  buyerId      String
  truckNo      String
  dispatchedAt DateTime @default(now())
  invoiceId    String?
  rolls        Roll[]
}

model Invoice {
  id         String   @id @default(uuid())
  invoiceNo  String   @unique
  orderId    String
  order      Order    @relation(fields: [orderId], references: [id])
  buyerId    String
  subtotal   Float
  gst        Float
  total      Float
  status     String
  payments   Payment[]
}

model Payment {
  id         String   @id @default(uuid())
  invoiceId  String
  invoice    Invoice  @relation(fields: [invoiceId], references: [id])
  amount     Float
  receivedAt DateTime @default(now())
  mode       String
}

model Worker {
  id         String   @id @default(uuid())
  name       String
  dailyWage  Float
  role       String
  attendance Attendance[]
}

model Attendance {
  id        String   @id @default(uuid())
  workerId  String
  worker    Worker   @relation(fields: [workerId], references: [id])
  date      DateTime
  shift     String
  status    String   // present|absent|half_day
  machineId String?
}

model Expense {
  id       String   @id @default(uuid())
  category String   // yarn|wages|power|overhead|other
  amount   Float
  date     DateTime
  orderId  String?
}

model Notification {
  id        String   @id @default(uuid())
  type      String
  message   String
  severity  String   // info|warning|critical
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(uuid())
  entity    String
  entityId  String
  action    String
  oldValue  String?
  newValue  String?
  userId    String
  at        DateTime @default(now())
}
```

## API route contract (fixed paths — implement only the ones your prompt lists)

```
POST /api/auth/login

GET/POST /api/yarn-types
GET/POST /api/yarn-lots
GET      /api/yarn/low-stock

GET/POST /api/orders
POST     /api/orders/feasibility
GET      /api/orders/:id
GET      /api/track/:token                 (public, read-only, no auth)
GET      /api/invoices/:id

GET/POST /api/machines
PATCH    /api/machines/:id/status
GET/POST /api/work-orders
POST     /api/production-logs

GET/POST /api/rolls
GET      /api/rolls/by-qr/:token
POST     /api/rolls/:id/qc
POST     /api/dispatches

GET/POST /api/attendance
GET/POST /api/expenses
GET/POST /api/payments

GET /api/analytics/cost-per-order
GET /api/analytics/machine-output
GET /api/analytics/defects
GET /api/analytics/profit-month

GET  /api/alerts
POST /api/assistant/query

Realtime events (socket.io): "machine:status", "order:status", "stock:changed", "notification:new"
```

Every write endpoint: validate with the matching zod schema from `src/lib/validation/`,
return `400` with `{ fieldErrors: { ... } }` on failure. Never trust client-side
validation alone.

## Validation rules you must enforce server-side (not exhaustive, the spec has more)

- Quantities are positive; units are explicit (kg or metres).
- Order deadline cannot be in the past.
- Order cannot move to `IN_PRODUCTION` unless yarn is reserved.
- Status transitions follow the defined order only, no skipping.
- QC `REJECT`/`REWORK` requires at least one defect.
- Dispatch only includes `PASS` rolls belonging to that buyer's order; a roll with a
  `dispatchId` can never be dispatched again.
- Stock (`qtyRemainingKg`) can never go negative.
- Invoice numbers are unique and sequential.

## Design tokens (put in `src/lib/tokens.ts`, consume everywhere, never hardcode)

- Status colours, used consistently everywhere: green = running/pass, amber =
  idle/rework, red = breakdown/reject, grey = pending.
- One spacing scale, one radius, one font-size scale — define once, reuse.

## Git workflow (all four of you)

- Branch per module: `feature/inventory-orders`, `feature/production`,
  `feature/quality-dispatch`, `feature/accounts-ai`.
- Small, frequent commits with conventional messages: `feat(qc): add defect types to QC form`.
- Open a PR into `main` as soon as your core flow piece works — don't wait until your
  whole module is done. Merge at least every hour. Pull `main` before you start each
  new work session so you have everyone else's latest schema/shared-lib changes.
- **Do not `git add -A` blindly** — check `git status` before committing so you don't
  accidentally commit another module's in-progress files or your local `.env`/`dev.db`.
- Append your own section to `AI_NOTES.md` (don't touch others'): what you generated
  with AI, what you changed/reviewed by hand.
- No commit in this repo should add any AI tool as a co-author/contributor — commits
  are authored by the human teammate only.

## Definition of done for your slice

- Works end-to-end against the real SQLite DB (no static JSON except your seed data).
- Server-side validation on every write you own, with clear field errors surfaced in the UI.
- Responsive (mobile-first for floor/QC/store screens), uses only the shared component library and tokens.
- Your section of `scripts/seed.ts` produces realistic demo data for your module.
- Your section of `AI_NOTES.md` is filled in.


---

## Your specific scope

You own:
1. **Accounts/HR**: `Worker` CRUD, `Attendance` entry (date, shift, status,
   optional machine), `Expense` entry (category yarn/wages/power/overhead/other,
   optionally linked to an order), `Payment` entry against an `Invoice` (you read
   `Invoice` rows written by Module 1, you own `Payment`). Month-end summary view.
   Routes: `app/(accounts)/...`, `app/api/attendance`, `app/api/expenses`,
   `app/api/payments`.
2. **True cost per roll/order & profit**: yarn used (including wastage, read from
   `Roll`/`YarnLot` rows), wages allocated (from `Attendance`/`Worker`),
   machine/power estimate (from `ProductionLog`/`Machine`), overhead (from
   `Expense`) — computed from real rows via query, never typed in by a human.
   Compare to `Order.pricePerMetre * qtyMetres` for profit per order.
   Route: `GET /api/analytics/cost-per-order`.
3. **Owner dashboard**: the main `/dashboard` page — cost/profit per order,
   machine output (`GET /api/analytics/machine-output`, reading Module 2's data),
   defect callouts (`GET /api/analytics/defects`, reading Module 3's data),
   `GET /api/analytics/profit-month`. This page aggregates everyone's analytics
   endpoints — build it to degrade gracefully (empty state, not a crash) if
   another module's endpoint isn't live yet.
4. **Alerts/notification centre**: in-app notification list UI reading the
   shared `Notification` table (any module can write to it — you build the
   read/display side: `GET /api/alerts`, a bell icon + panel, mark-as-read) plus
   a simulated WhatsApp-style message preview (clearly marked as a preview, no
   real sending).
5. **Audit trail view**: a page/table reading `AuditLog` (written by everyone via
   the shared `logAudit` helper from Module 1) — who changed what, when, for
   stock/QC/status changes.
6. **Owner AI assistant**: chat UI (`app/(assistant)/...`) + `POST
   /api/assistant/query`, backed by a local model via Ollama. The model must turn
   the natural-language question into a call against a **whitelisted set of
   read-only query functions** you define over the schema above (e.g.
   `profitByOrder(month)`, `machineRejectRate(machineId)`) — never let it
   generate arbitrary SQL, and never let it answer from anything but the
   returned data; if the data needed isn't available, it must say so rather than
   invent a number. This only needs read access to tables other modules own —
   you don't need their code, just their rows, which exist once they've seeded.
7. Your section of `scripts/seed.ts`: a month of attendance, expenses and
   payments consistent with Module 1's buyers/orders and invoices.
8. Your section of `AI_NOTES.md`.

## Explicitly not yours

Don't write to `YarnType`, `YarnLot`, `Order`, `Buyer`, `Supplier`, `Invoice`
(read-only), `Machine`, `WorkOrder`, `ProductionLog`, `Roll`, `QCRecord`,
`Dispatch`. Don't build inventory, orders, production, QC, dispatch, or the
offline queue — those belong to other agents; you read their output.

## Order of operations

1. Pull `main`. Confirm schema/shared libs exist; if not, use the contract above
   as ground truth and don't block on waiting.
2. Build Worker/Attendance/Expense/Payment CRUD against your own tables first —
   this doesn't depend on anyone else and can be done hour 0.
3. Build the whitelisted query functions for the AI assistant and the cost/profit
   analytics query — these only need the schema, you can write them against
   seed data you generate yourself before other modules' real data exists.
4. Wire the owner dashboard, swapping in the other modules' analytics endpoints
   as they come online (check with the team / re-pull `main` periodically).
5. Build alerts/notification centre and the audit trail view.
6. Build the AI assistant chat UI on top of the query functions, local model via
   Ollama, no external API calls.
7. Seed data, `AI_NOTES.md`.

## Done means

Cost-per-order and profit numbers are traceable to real rows, not estimates. The
AI assistant answers "which order made the least profit this month?" correctly
from real data and says so plainly if it can't, never fabricating a number. The
dashboard renders cleanly even before every other module's data exists.
