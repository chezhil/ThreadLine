# Your task: Module 1 — Foundation, Inventory/Purchase & Orders/Buyer Portal
(Agent: Claude — teammate: Chezhil)

You are one of four AI agents building **ThreadLine**, a textile-mill management
system, in parallel. Two files are attached alongside this prompt:
`everest-mill-build-spec.md` (full product spec) and `Textile_Manufacturing_System.pdf`
(problem statement). Read both fully before writing code.

The other three agents are building Production, Quality/Dispatch, and
Accounts/Dashboard/AI at the same time, each in their own branch, against the shared
contract below. **You go first on the schema and shared infrastructure** — the other
three are starting immediately too, so push early and often (within the first hour)
so they can pull your work instead of inventing their own.

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
1. **Project bootstrap**: `package.json`, `tsconfig.json`, Tailwind config, Prisma
   setup, the full `prisma/schema.prisma` from the shared contract above, initial
   migration, `src/lib/db.ts`, `src/lib/auth.ts` (simple hashed-password login,
   seeded demo users per role), `src/lib/realtime.ts` (socket.io server + client
   hook, even if just the plumbing — other modules will emit/listen on it),
   `src/lib/audit.ts` (the shared `logAudit` helper), `src/lib/tokens.ts` +
   Tailwind theme wired to it, and the base `src/components/ui/` library (Button,
   Input, Select, Table, Badge, Card, Drawer, EmptyState).
2. **App shell**: sidebar (desktop, grouped Dashboard/Orders/Production/Quality/
   Inventory/Dispatch/Accounts/Alerts/Assistant) + bottom tab bar (mobile, role's
   top 4 actions), role-based menu visibility, breadcrumbs on detail pages,
   login page.
3. **Inventory & Purchase**: yarn intake form (supplier, yarn type/count, colour,
   quantity kg, lot number, optional linked order), supplier CRUD, live stock
   view, low-stock threshold alert (push a `notification:new` + `stock:changed`
   event). Routes: `app/(inventory)/...`, `app/api/yarn-types`, `app/api/yarn-lots`,
   `app/api/yarn/low-stock`.
4. **Orders & Buyer Portal**: order creation (buyer, fabric type, colour, GSM, qty
   metres, deadline, price/metre), status machine `NEW → CONFIRMED →
   IN_PRODUCTION → QC → READY → DISPATCHED → CLOSED` (enforce legal transitions
   only), **feasibility check** (compute yarn needed with a wastage %, compare to
   `qtyRemainingKg` across lots, check free machine capacity before the deadline
   using `Machine.capacityMetresPerShift` — you can read Machine rows but you do
   not own that table's writes — and return `FEASIBLE` / `FEASIBLE IF you order X
   kg yarn` / `DEADLINE NOT REALISTIC` with a reason), public buyer tracking page
   at `app/track/[token]` + `GET /api/track/:token` (no login — progress bar yarn
   reserved → weaving → dyeing → QC → ready → dispatched, estimated delivery,
   rolls ready vs total — read-only against Order/WorkOrder/Roll, which other
   modules write to), GST invoice generation + `GET /api/invoices/:id`
   (sequential unique invoice numbers, mill-style order numbers like
   `EVR-2610-014`).
5. Your section of `scripts/seed.ts`: 5 buyers, 4 suppliers, 6 yarn types with lots
   (one deliberately near low-stock), 10 orders across all statuses (one at delay
   risk, one infeasible).
6. Your section of `AI_NOTES.md`.

## Explicitly not yours

Do not write to `Machine`, `WorkOrder`, `ProductionLog`, `Roll`, `QCRecord`,
`Dispatch`, `Worker`, `Attendance`, `Expense`, `Payment` outside of read-only
queries needed for the feasibility check and the tracking page. Don't build the
floor board, QC screens, dispatch flow, or the AI assistant — those are other
agents' modules, built against the schema and shared libs you push.

## Order of operations

1. Bootstrap the repo, schema, shared libs, design system, app shell, auth. Commit
   and push to `main` (small commits, not one giant one) as early as possible —
   the other three agents need this to start.
2. Build inventory (yarn intake → stock → low-stock alert) end to end.
3. Build orders end to end, including feasibility check.
4. Build the public tracking page and GST invoice.
5. Fill in your seed data and `AI_NOTES.md` section.

## Done means

Feasibility check gives a real answer (not a guess) using actual stock and machine
capacity rows. The tracking page works for a buyer with no login. Low-stock alert
fires through the shared notification/realtime channel. Everything validated
server-side with zod, responsive, using only the shared component library and
tokens.
