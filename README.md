<div align="center">

# ThreadLine

**The operating system for a textile mill: any order, any roll, any rupee — in seconds.**

ThreadLine is a full-stack ERP built for **Everest Textile Mills, Surat**. It follows a
fabric order from the moment a buyer places it, through yarn reservation, spinning,
weaving and dyeing on the loom floor, roll-by-roll quality inspection, truck dispatch and
GST invoicing, all the way to the buyer's payment — and tells the owner exactly what every
order really cost and earned.

[![Verify ThreadLine](https://github.com/chezhil/ThreadLine/actions/workflows/verify.yml/badge.svg)](https://github.com/chezhil/ThreadLine/actions/workflows/verify.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Prisma 5](https://img.shields.io/badge/Prisma-5.22-2d3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169e1?logo=postgresql&logoColor=white)
![Socket.IO](https://img.shields.io/badge/realtime-Socket.IO-010101?logo=socket.io)
![PWA](https://img.shields.io/badge/PWA-offline%20ready-5a0fc8)

</div>

---

## Table of contents

1. [Why ThreadLine exists](#why-threadline-exists)
2. [Highlights](#highlights)
3. [Who uses it — roles and permissions](#who-uses-it--roles-and-permissions)
4. [A tour of the app, tab by tab](#a-tour-of-the-app-tab-by-tab)
5. [How an order flows through the mill](#how-an-order-flows-through-the-mill)
6. [Tech stack](#tech-stack)
7. [Architecture at a glance](#architecture-at-a-glance)
8. [Getting started](#getting-started)
9. [Configuration (environment variables)](#configuration-environment-variables)
10. [npm scripts](#npm-scripts)
11. [Testing and quality gates](#testing-and-quality-gates)
12. [Deployment](#deployment)
13. [WhatsApp buyer alerts](#whatsapp-buyer-alerts)
14. [Project structure](#project-structure)
15. [Performance and scale](#performance-and-scale)
16. [Security](#security)
17. [Troubleshooting](#troubleshooting)
18. [Further documentation](#further-documentation)
19. [Team](#team)

---

## Why ThreadLine exists

A mid-sized textile mill runs on paper registers, WhatsApp messages and spreadsheets that
never agree with each other. The owner cannot answer simple questions without a day of
phone calls:

- *Can we deliver this 1,200 m order by the 20th — do we have the yarn and the loom time?*
- *Which loom is producing the rejected rolls, and is it the machine or the yarn lot?*
- *Has this truck already left with these rolls? Was the buyer invoiced?*
- *What did order EVR-2610-004 actually cost us once wages, power and wastage are counted?*

ThreadLine replaces those registers with one live system. Every role on the floor records
their work where it happens (on a phone, even offline), and every number the owner sees is
computed from those real records — never typed in by hand.

## Highlights

| | |
|---|---|
| **End-to-end order lifecycle** | Order → feasibility check → yarn reservation → work orders per stage → production logs → rolls → QC → dispatch → GST invoice → payment. Order status is *derived* from real events, not set by hand. |
| **Live loom floor** | Machine status, today's output and order progress push to every screen in real time over Socket.IO. Tiles flash when a live update lands. |
| **QR-tagged rolls** | Every roll gets an unguessable QR token and a printable label. Inspectors and storekeepers scan with the phone camera (or a barcode gun) to inspect or load a roll. |
| **Defect root-cause analytics** | Rejection rates by machine, shift, yarn lot and defect type, with plain-language callouts ("Loom 4 produced 70% of all rejects this period"). |
| **True cost per order** | Yarn (with wastage), direct wages from the attendance muster, power and overheads spread over machine-shifts, and linked bills — every rupee traceable to its source rows. |
| **Accounts & month-end** | Workers, attendance, expenses, buyer payments, accrual P&L, receivables and a one-click month-end CSV. Mistakes are corrected with reverse-and-correct, never silently edited. |
| **Approvals** | Yarn purchase requests (from low stock), machine maintenance requests (from breakdowns) and wage payout approvals, all decided by the owner. |
| **Alerts that matter to each role** | Low stock, delay risk, breakdowns, orders ready, payments — each role only sees and counts the alerts it can act on. Optional WhatsApp delivery to buyers. |
| **AI query assistant** | Ask the mill a question in plain English. The model can only run a fixed set of read-only queries, and every number in its answer is checked against the data. |
| **Offline-first PWA** | QC inspections and dispatches queue in IndexedDB when the network drops and replay safely (idempotently) when it returns. Installable on a phone. |
| **Buyer tracking portal** | Each order has a no-login tracking link the buyer can open to follow production and dispatch. |
| **Audit trail** | Who changed what and when, across every module, with before/after values. |

## Who uses it — roles and permissions

ThreadLine has four roles. Each one signs in to a home page built for its job, and the
sidebar, the mobile bottom bar, the command menu and every API route only expose what that
role is allowed to do. Permissions are enforced **on the server** for every request; hiding
a button is never the only protection.

| Area | Owner | Storekeeper | Floor supervisor | QC inspector |
|---|:---:|:---:|:---:|:---:|
| Owner dashboard | ✅ | | | |
| Orders & buyers | ✅ | | | |
| Yarn reservation on orders | ✅ | ✅ | | |
| Production — floor board, work orders, machines | ✅ | | ✅ | |
| Quality — QC queue, rolls & labels, defect analytics | ✅ | | (rolls) | ✅ |
| Yarn & inventory, suppliers, purchase requests | ✅ | ✅ | | |
| Dispatch & GST invoicing | ✅ | ✅ | | |
| Accounts — costing, payments, expenses, workers, attendance | ✅ | | | |
| Approvals (decide) | ✅ | | | |
| Raise a purchase / maintenance request | ✅ | purchase | maintenance | |
| Mill alerts | all alerts | stock, reorder, orders ready, purchase decisions | delay risk, breakdowns, reorder, maintenance decisions | breakdowns, orders ready |
| AI query assistant | ✅ | | | |
| Audit trail | ✅ | | | |
| Profile, preferences, security | ✅ | ✅ | ✅ | ✅ |

**Home page after sign-in:** owner → Dashboard · storekeeper → Inventory · floor supervisor
→ Floor board · QC inspector → QC queue. Each user can pick a different start page in
Preferences (only from pages their role can open).

## A tour of the app, tab by tab

### Sign-in (`/login`)

Username and password, with a **Show/Hide** toggle for the password. **Forgot password?**
opens a short note: passwords are reset by the mill administrator, so users are told to
contact them. Wrong credentials, network failures and server errors each show a clear
message. Sessions are HTTP-only cookies valid for seven days.

### The app shell (every page)

- **Sidebar** — the role's navigation, grouped into *Mill navigation* and *Control room*,
  with live unread counts. The ☰ button collapses it to an icon rail (remembered per user).
  The ThreadLine logo always takes you to your home page.
- **Header** — page title, a live **Mill telemetry** indicator (realtime connection), the
  mill clock in IST, the **Online / Offline · Synced** pill for the offline queue (click it
  to see queued actions, retry or discard them), the command-menu button, the **notification
  bell**, and the **account menu** (profile, settings, sign out).
- **Breadcrumbs** and, for the owner, an **Ask Assistant** shortcut.
- **Bottom tab bar on phones** with the role's three to five most-used pages.
- **Command menu** — `Ctrl/⌘ + K` to jump to any page or search orders by number, buyer or
  fabric, switch theme, or sign out.
- **Keyboard shortcuts** — `?` lists them, `[` collapses the sidebar, `G` then a letter goes
  to a page (for example `G` `D` for the dashboard). Shortcuts never fire while you type.
- **Live toasts** — new alerts relevant to your role pop up in the corner (optional sound).
- **Every list pages the same way** — 25 rows per page on the client (50 for lists that are
  paged by the server), with a "1–25 of 340 · Page 1 of 14" footer.

### Owner — Dashboard (`/dashboard`)

The owner's single screen, refreshed live:

- **Today's output** — metres produced today against rated capacity, with a 7-day trend.
- **Active looms availability** — running / idle / down counts, 7-day utilisation, and which
  machines are in maintenance or breakdown.
- **Revenue booked** this month (ex-GST), margin, net profit and GST invoiced.
- **Pending receivables** — outstanding amount, open invoices to collect, and money collected
  this month.
- **Live loom shed telemetry** — a tile per machine with its status, metres today, an output
  sparkline and utilisation; filter by running, idle or breakdown.
- **Order profitability & direct margins** — every order this month with direct cost, revenue
  and net margin, a search box, CSV export and paging.
- **Quality outlier** — the machine responsible for the largest share of rejected rolls in the
  last 30 days, with its defect signature and links to the analytics and machine status.
- **Mill alerts** (latest unread) and a mini **AI query terminal**.
- A **month picker** to look back at earlier months, and an approvals banner when something is
  waiting for the owner.

### Orders & Buyers (`/orders`, `/orders/buyers`, `/orders/[id]`)

- **Orders** — every order with buyer, fabric, GSM, colour, quantity, deadline and status.
  Search, filter by status, sort by urgency (open orders by nearest deadline first) or other
  columns, and page through results. **New order** opens a form that runs a **feasibility
  check** first: given the yarn on hand and the machines' capacity, can the order be made by
  its deadline? The check reports why when it can't.
- **Order detail** — order details and status, **yarn reservations** (reserve kilograms from a
  specific lot; release a reservation), the **GST invoice** (5% GST, numbered `INV-YYMM-NNNN`),
  the **buyer tracking link** to share, a WhatsApp message preview, and delete for orders
  that have no history yet.
- **Status is derived, not typed**: `NEW → CONFIRMED → IN_PRODUCTION → QC → READY →
  DISPATCHED → CLOSED`, with separate production, QC, dispatch (partial / full) and payment
  (unpaid / partial / paid) statuses computed from the real work orders, rolls, dispatches
  and payments.
- **Buyers** — the buyer directory (name, contact, GSTIN, address), with edit, archive and
  restore; a buyer with orders can be archived but not deleted.

### Production (`/production/floor-board`, `/production/work-orders`, `/production/machines`)

- **Floor board** — a live card per machine: status (running, idle, maintenance, breakdown),
  type, metres produced today, and the active work order's progress bar. Below it, **orders
  at delay risk** (remaining work exceeds the shifts left before the deadline) and **yarn
  reorder suggestions** from the last seven days of usage. Cards flash when a machine's status
  or output changes.
- **Work orders** — create a work order for an order's stage (spinning → weaving → dyeing, in
  that order) on a free machine of the right type, and **record shift output** in metres.
  Each work order card shows planned vs produced, its production log, and lets the
  supervisor re-plan, correct a mistyped entry (completed stages reopen if corrected down)
  or remove an empty work order. The list is searchable, filterable and paged on the server.
- **Machines** — add machines (type and capacity per shift), change status, edit or remove,
  and raise a **maintenance request** for a broken-down machine.

### Quality (`/quality/qc`, `/quality/rolls`, `/quality/defects`)

- **QC queue** — every roll with its order, machine, shift, dimensions, yarn lot and QC status.
  Tiles show how many rolls are pending, passed, in rework and rejected across the whole mill.
  **Inspect** opens a drawer to record PASS, REWORK or REJECT; rework and reject require at
  least one defect (hole, colour mismatch, uneven weave) and optional notes. **Scan Roll QR**
  opens the camera scanner (or manual entry) to jump straight to a roll. Works offline.
  Search, status filter and paging all happen on the server.
- **Rolls & labels** — the roll registry. **Mint a roll** from a weaving work order (order,
  loom, shift, yarn lot, length, weight). **Print QR label** opens a printable mill label
  with the QR code, roll number, order, machine, shift, length, weight and yarn lot; it prints
  only the label and can also be downloaded as PNG or the token copied.
- **Roll detail** — the roll's full lineage: order and buyer, machine and shift, yarn type,
  lot and supplier, every QC inspection (and its reversal, if one was corrected), and the
  dispatch it left on. Rolls can be edited or deleted only while it is safe to do so.
- **Defect analytics** — inspected / pass / rework / reject totals and rates for a chosen
  period, rejection rate by machine, defect type distribution, rejections by shift, and
  defects traced back to yarn lots and suppliers — with plain-language callouts.

### Yarn & Inventory (`/inventory`)

- **Stock** — yarn types (count, material, colour, cost per kg, low-stock threshold) with
  kilograms on hand across their lots; a **low stock** card with a one-click **purchase
  request**.
- **Yarn lots** — record intake (lot number, yarn type, supplier, kilograms, date), edit or
  remove lots that have not been used.
- **Suppliers** — the supplier directory, with archive and restore.
- Low-stock alerts are raised and cleared automatically as stock moves.

### Dispatch (`/dispatch`)

- **New truck dispatch** — choose the buyer and truck number; the screen lists that buyer's
  **QC-passed rolls still in the warehouse** (paged), lets you select rolls or **scan them onto
  the truck** with the camera, and shows a live **dispatch manifest** (rolls, metres, weight)
  and **GST invoice preview**. Dispatching is protected against double dispatch on the server:
  a roll can leave on exactly one truck. The first truck for an order raises its GST invoice.
  Works offline (queued and replayed).
- **Dispatch history** — every truck with its rolls, metres, invoice and date (paged), with an
  option to correct the truck number and to send or preview the buyer's WhatsApp message.

### Accounts & Margins (`/accounts/...`) — owner only

- **Month-end** — accrual P&L for a month (revenue, cost of the orders booked, gross and net
  profit), invoicing and GST, receivables, payments received, the labour and overhead pool
  (power, overheads, indirect labour spread over machine-shifts, unabsorbed cost), the
  muster summary, every bill recorded, and a **CSV export** for the accountant.
- **Cost per order** — "true cost" for every order: yarn (with 8% process wastage), direct
  wages, power, overhead and direct bills, revenue and profit. Click an order for the full
  breakdown, the rolls it produced, and the **ledger** entries behind it. Orders show what data
  is missing instead of pretending ₹0 is real.
- **Payments** — invoices with their outstanding balance; record a payment (amount, mode,
  date). A payment can never exceed what is outstanding — even with two requests at once.
  Payments, invoices and expenses are corrected by **reversal**: the original stays on the
  record, a reversal cancels it, and the corrected entry replaces it.
- **Expenses** — power, overhead, yarn and wage bills, optionally linked to an order.
- **Workers** — workers with role and daily wage; archive and restore.
- **Attendance** — the shift muster (present / half day / absent, and the machine each operator
  worked). Operators marked on a machine have their wage charged to the orders that machine
  produced that day. A month's attendance locks once its wage payout is approved.

### Approvals (`/approvals`) — owner only

Three queues: **yarn purchase requests** (raised from Inventory's low-stock card), **machine
maintenance requests** (raised from Production when a machine breaks down, with an optional
repair estimate), and **payout approvals** (flag a month's wages for payout, then approve).
Every decision notifies the person who asked.

### Mill Alerts (`/alerts`) — every role

The notification centre: search, filter by severity and type, show unread or all, and mark
alerts read or unread (read state is per user). The owner also sees the **WhatsApp preview**
for a selected alert and the **delivery outbox** for buyer messages (queued, sent, delivered,
read or failed, with "Process now"). Each role only sees the alert types relevant to its job.

### AI Query Assistant (`/assistant`) — owner only

Ask questions such as *"Which order made the least profit this month?"*, *"Which machine has
the highest reject rate?"* or *"Who was absent the most last month?"*. Under the hood the
model chooses one of a fixed set of **read-only** tools (profit by order, order cost, month
summary, machine output, reject rates, defects by type, yarn stock, outstanding payments,
attendance, orders overview, recent alerts); it never writes SQL. Every number in its answer
is checked against the tool's result — if any number does not match, the answer is replaced
by a deterministic summary of the same data. Without an API key the assistant still works
through a keyword router and says so.

### Audit Trail (`/audit`) — owner only

Every create, update, status change, reversal and correction across modules, with the user,
time, entity and before/after values. Filter by entity, action, user and date range, search
the values, and page through history.

### Profile & settings (`/profile`) — every role

- **Profile** — full name, email, phone, job title and a profile photo (resized in the
  browser).
- **Preferences** — theme (light, dark or follow the device), text size, reduced motion,
  12/24-hour clock, seconds on the clock, start page, alert pop-ups and sound. Stored per user
  in the database and applied on the server, so there is no flash of the wrong theme.
- **Notifications**, **Security** (change password — current password required, rate-limited;
  see and sign out other devices) and **Activity** (your own recent changes).

### Buyer tracking portal (`/track/[token]`) — public, no login

A read-only page for the buyer: order number, fabric, quantity, deadline, production and
dispatch progress, and trucks that have left. The token is unguessable and the page reveals
nothing beyond that one order.

## How an order flows through the mill

```mermaid
flowchart LR
    A[Order created<br/>feasibility check] --> B[Yarn reserved<br/>from lots]
    B --> C[Work orders<br/>spinning → weaving → dyeing]
    C --> D[Shift output logged<br/>on the floor board]
    D --> E[Rolls minted<br/>QR label printed]
    E --> F{QC inspection}
    F -- PASS --> G[Warehouse]
    F -- REWORK / REJECT --> H[Defect analytics<br/>root cause]
    G --> I[Truck dispatch<br/>scan rolls]
    I --> J[GST invoice]
    J --> K[Buyer payment]
    K --> L[True cost &<br/>month-end P&L]
```

Each arrow is a real record (reservation, work order, production log, roll, QC record,
dispatch, invoice, payment, ledger entry), and the order's status follows those records
automatically. The buyer can watch the same progress on their tracking link.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack, Cache Components), **React 19** | One codebase for UI and API routes; server-rendered shell with client islands |
| Language | **TypeScript 5** (strict) | End-to-end types from the database to the UI |
| Styling | **Tailwind CSS 4** with design tokens, light and dark themes | A consistent, themeable industrial UI |
| Icons | **lucide-react** | |
| Database | **PostgreSQL** (Supabase in production) | Relational integrity for money and stock |
| ORM | **Prisma 5.22** with the `pg` driver adapter (`driverAdapters`) | Type-safe queries; one network round trip per query through Supabase's pooler |
| Validation | **Zod 4** | The same schemas validate forms and API requests; field errors return as `{ fieldErrors }` |
| Realtime | **Socket.IO 4** on a custom Node server (`server.js`) | Live floor board, QC, dispatch, alerts; only signed-in sessions can connect |
| Auth | Session cookies (HTTP-only, SHA-256 hashed tokens in the database), **bcryptjs** passwords | No third-party auth dependency |
| Offline | **IndexedDB** (`idb`) queue + service worker, PWA manifest | Inspections and dispatches survive a dead network |
| QR | **qrcode** (labels), **jsQR** (camera scanning) | No external scanning service |
| AI | **Groq** chat completions (default model `openai/gpt-oss-120b`), tool-calling with Zod-validated arguments | Fast, cheap, server-side only |
| Messaging | **WhatsApp Cloud API** (optional), delivery outbox with retries and signed webhooks | Buyer notifications |
| Testing | **Playwright** end-to-end, 14 `verify-*` integration scripts, GitHub Actions | |
| Hosting | **Railway** (Nixpacks) + **Supabase** Postgres | |

## Architecture at a glance

```mermaid
flowchart TB
    subgraph Client[Browser / installed PWA]
      UI[React 19 pages<br/>per role]
      Q[(IndexedDB<br/>offline queue)]
      SW[Service worker]
    end
    subgraph Server[Node process — server.js]
      NX[Next.js 16<br/>pages + /api routes]
      IO[Socket.IO<br/>/api/socketio]
      OB[Alert outbox drain]
    end
    DB[(PostgreSQL<br/>Supabase)]
    GQ[Groq API]
    WA[WhatsApp Cloud API]

    UI -- fetch /api --> NX
    UI <-- live events --> IO
    Q -- replay when online --> NX
    NX -- Prisma + pg --> DB
    NX -- emit --> IO
    NX -- read-only tools --> GQ
    OB --> WA
    WA -- signed webhooks --> NX
```

- **One process** serves pages, the REST-style API under `/api`, and Socket.IO on the same
  HTTP server. API routes emit realtime events after every write; clients refetch only what
  changed.
- **Writes that read-then-write** (stock reservation, dispatch, invoice numbering, payments,
  preferences) run inside serialised transactions with row locks and retries, so concurrent
  requests cannot oversell stock, double-dispatch a roll or overpay an invoice.
- **Derived state** — order statuses, alerts (machine breakdown, order ready, low stock, delay
  risk) and costing are computed from records, never stored as free-typed values.
- **Corrections are append-only** — payments, invoices, expenses and QC results are reversed
  and replaced, and every change is written to the audit log and the ledger.

The detailed design — realtime, concurrency, costing maths, offline sync, the assistant's
guard rails and data model — is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every API
route, its methods and the roles allowed are in [docs/API.md](docs/API.md).

## Getting started

### Prerequisites

- **Node.js ≥ 20.9** (CI uses Node 24) and npm
- **PostgreSQL 14+** — a local server, Docker, or a free [Supabase](https://supabase.com) project

### 1. Install

```bash
git clone https://github.com/chezhil/ThreadLine.git
cd ThreadLine
npm install
cp .env.example .env
```

### 2. Point it at a database

**Option A — local Postgres with Docker (quickest for development):**

```bash
docker run --name threadline-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=threadline \
  -p 5432:5432 -d postgres:16
```

```dotenv
# .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/threadline"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/threadline"
```

**Option B — Supabase:** from *Project → Connect*, use the **transaction pooler** (port
`6543`) for the app and the **session pooler** (port `5432`) for migrations:

```dotenv
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5"
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

> Special characters in the password must be URL-encoded (`!` → `%21`, `@` → `%40`, `#` → `%23`).

### 3. Create the schema and seed demo data

```bash
npx prisma migrate deploy   # or: npm run db:migrate (creates migrations in development)
npm run seed
```

The seed builds a realistic mill: users for all four roles, suppliers, buyers, yarn types and
lots, orders in every status, machines (including one in breakdown and a loom with a defect
cluster for the analytics), work orders and production logs, ~80 QR-tagged rolls with QC
results, dispatches, invoices, workers, attendance, expenses and payments. Running it again
adds nothing. To start over: `npx prisma migrate reset`.

### 4. Run

```bash
npm run dev          # development, http://localhost:3000
# or
npm run build && npm run start   # production build
```

> Always start through `npm run dev` / `npm run start`: they run `server.js`, which hosts
> Socket.IO next to Next.js. Plain `next dev` has no realtime.

### Demo accounts

| Role | Username | Password | Lands on |
|---|---|---|---|
| Owner | `owner` | `owner123` | Dashboard |
| Storekeeper | `storekeeper` | `store123` | Inventory |
| Floor supervisor | `floor` | `floor123` | Floor board |
| QC inspector | `qc` | `qc123` | QC queue |

Change these passwords before exposing an instance to anyone (Profile → Security).

### Try a live demo

```bash
npm run demo:live
```

drives real traffic through the real API (logs production, toggles machines, inspects rolls,
dispatches trucks) so the realtime dashboards visibly update without anyone clicking.

## Configuration (environment variables)

All variables live in `.env` (see [`.env.example`](.env.example)). Only the database URLs are
required; everything else switches on an optional integration.

| Variable | Required | Purpose |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Postgres URL the app uses at runtime. On Supabase use the transaction pooler (`:6543`, `pgbouncer=true`). `connection_limit` sets the pool size. |
| `DIRECT_URL` | ✅ | Direct/session connection used by `prisma migrate`. |
| `PORT` | | HTTP port (default `3000`). |
| `GROQ_API_KEY` | | Enables the AI assistant's model. Without it the assistant answers through its keyword router. |
| `GROQ_MODEL` | | Model name (default `openai/gpt-oss-120b`). |
| `GROQ_TIMEOUT_MS` | | Model request timeout (default `20000`). |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | | Send buyer alerts through the WhatsApp Cloud API. Without them deliveries are simulated. |
| `WHATSAPP_TEMPLATE_ORDER_READY`, `WHATSAPP_TEMPLATE_ORDER_DISPATCHED`, `WHATSAPP_TEMPLATE_LANG` | | Approved Meta templates for messages outside the 24-hour window. |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | | Verify and authenticate the delivery-receipt webhook. |
| `NEXT_PUBLIC_APP_URL` | | Public base URL used in tracking links inside messages. |
| `ALERT_WORKER_TOKEN` | | Any long random string: the web process drains the alert outbox every 15 s by itself (otherwise run `npm run alerts:worker`). |

`GET /api/health` reports `db`, `groq` and `whatsapp` readiness and is suitable for uptime
checks.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server with realtime (`server.js`, Turbopack). |
| `npm run build` | Production build (`next build`). |
| `npm run start` | Start the production server with realtime. |
| `npm run lint` | ESLint (Next.js + React Compiler rules). |
| `npm run seed` | Seed the demo mill (idempotent). |
| `npm run db:migrate` | `prisma migrate dev`. |
| `npm run db:studio` | Browse the database in Prisma Studio. |
| `npm run alerts:worker` | Standalone worker that drains the WhatsApp alert outbox. |
| `npm run demo:live` | Generate live activity for demos. |
| `npm run loadtest` | Load-test key endpoints. |
| `npm run test:e2e` | Playwright end-to-end suite (needs a running, seeded server). |

## Testing and quality gates

ThreadLine is verified at three levels, and **every push to `main` and every pull request
runs all of them** in GitHub Actions against a fresh Postgres
([`.github/workflows/verify.yml`](.github/workflows/verify.yml)).

**1. Static checks** — `npx tsc --noEmit`, `npm run lint` (zero warnings), `npm run build`,
and `npm audit --omit=dev`.

**2. Business-logic verification scripts** (in `scripts/`, run against a live server on a
seeded database with `BASE=http://localhost:3000`):

| Script | Covers |
|---|---|
| `verify-costing.ts` | Costing engine against a hand-checked fixture (42 figures) |
| `verify-integration.mjs` | One order through all four modules, plus role checks |
| `verify-accounts-api.mjs` | Accounts API: validation, roles, attendance, payments (53 checks) |
| `verify-hardening.ts` | Ledger, approvals, offline QC conflicts, outbox alerts, month-end CSV |
| `verify-order-status.ts` | Derived order status across production, QC, dispatch and payment |
| `verify-concurrency.ts` | Stock reservation, dispatch and invoice numbering under concurrent writes |
| `verify-crud.ts` | Edit / archive / delete / reverse-and-correct across every module (178 checks) |
| `verify-account.ts` | Profile, preferences, password and sessions (`/api/me/*`) |
| `verify-runtime.mjs` | Signed-in page shells and authenticated Socket.IO |
| `verify-assistant.ts` | Assistant guard rails against a scripted model |
| `verify-whatsapp-cloud.ts`, `verify-whatsapp-preview.ts` | WhatsApp delivery, receipts webhook, message preview |
| `verify-module3.ts` | Quality/dispatch seed sanity |

> `verify-accounts-api` approves the current month's wage payout, which locks that month's
> attendance, so run it before `verify-hardening` or reset the database between them.
> `verify-account` refuses to run if `BASE` and `DATABASE_URL` point at different databases.

**3. End-to-end UI tests** — `npx playwright test` (`tests/e2e/`): sign-in and role homes,
one golden path per module, the app shell (sidebar, account menu, theme, command menu,
shortcuts, text size), and the WhatsApp preview.

```bash
# typical local run
npm run build && npm run start &
BASE=http://localhost:3000 npx tsx scripts/verify-crud.ts
BASE=http://localhost:3000 npx playwright test
```

## Deployment

ThreadLine deploys as a single Node service. The repository includes a
[`railway.json`](railway.json):

- **Build:** `npm run build` (Nixpacks installs dependencies and runs `prisma generate`).
- **Start:** `npx prisma migrate deploy && npm run start` — migrations are applied before the
  server starts.
- **Variables:** set `DATABASE_URL` (Supabase transaction pooler, `:6543`,
  `pgbouncer=true`) and `DIRECT_URL` (session pooler, `:5432`), plus any optional integrations.
- **Health check:** `GET /api/health`.

Any platform that runs a long-lived Node process works (Render, Fly.io, a VM). Serverless
platforms are not suitable because Socket.IO needs a persistent server.

**Production checklist**

1. Change all seeded passwords, or create real users and remove the demo ones.
2. Use the Supabase transaction pooler for `DATABASE_URL`; keep `connection_limit` small.
3. Set `NEXT_PUBLIC_APP_URL` so tracking links in messages are correct.
4. Configure WhatsApp (below) and `ALERT_WORKER_TOKEN` if buyers should be notified.
5. Back up with your database provider's tooling (Supabase backups / `pg_dump`); the in-app
   backup/restore only applies to the legacy SQLite layout and is hidden on Postgres.

## WhatsApp buyer alerts

- **Open in WhatsApp** (dispatch and order pages) builds the buyer message on the server and
  opens a click-to-chat link. No setup needed.
- **Automatic buyer alerts** (order ready, order dispatched) go through a delivery **outbox**.
  With `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set they are sent through the
  WhatsApp Cloud API (drained by `ALERT_WORKER_TOKEN`, `npm run alerts:worker`, or "Process
  now" on the Alerts page); without them they are simulated.
- **Receipts:** point the Meta app's webhook at `https://<host>/api/webhooks/whatsapp` with
  `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` set. Delivered / read / failed receipts
  then show on the outbox. Requests without a valid `X-Hub-Signature-256` are rejected.
- Meta only allows business-initiated free text within 24 hours of the buyer's last message.
  For production, register two **Utility** templates (language `en`) and put their names in
  `WHATSAPP_TEMPLATE_ORDER_READY` / `WHATSAPP_TEMPLATE_ORDER_DISPATCHED`:
  - order ready: `Everest Textile Mills: Dear {{1}}, your order {{2}} has passed quality checks and is ready for dispatch. Track it live: {{3}}`
  - order dispatched: `Everest Textile Mills: Dear {{1}}, your order {{2}} is on its way on vehicle {{3}}. Track it live: {{4}}`

**Going live**

1. In Meta for Developers create a Business app, add WhatsApp, note the **Phone number ID**,
   create a permanent **System User access token** (`whatsapp_business_messaging`) and copy
   the **App secret**.
2. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN` and `NEXT_PUBLIC_APP_URL`, then redeploy.
3. WhatsApp → Configuration → Webhook: callback `https://<host>/api/webhooks/whatsapp`, the
   same verify token, subscribed to `messages`.
4. Submit the two templates; set the template variables once approved.
5. Set `ALERT_WORKER_TOKEN`, check `/api/health` shows `"whatsapp": true`, dispatch a test
   order to your own number and watch it go Delivered → Read on the outbox.

## Project structure

```text
ThreadLine/
├── server.js                  # Node entrypoint: Next.js + Socket.IO on one HTTP server
├── prisma/
│   ├── schema.prisma          # 28 models (orders, production, quality, accounts, alerts, audit)
│   └── migrations/            # versioned SQL migrations
├── scripts/                   # seed, verify-* suites, alert worker, demo/load generators
├── tests/e2e/                 # Playwright UI tests
├── public/                    # PWA manifest, service worker, icons
├── design/stitch/             # design reference export
├── docs/                      # architecture and API reference
└── src/
    ├── app/
    │   ├── (auth)/login/      # sign-in
    │   ├── (app)/             # signed-in shell and every module's pages
    │   │   ├── dashboard/ orders/ production/ quality/ inventory/ dispatch/
    │   │   ├── accounts/ approvals/ alerts/ assistant/ audit/ profile/
    │   ├── track/[token]/     # public buyer tracking page
    │   └── api/               # ~70 route handlers (see docs/API.md)
    ├── components/            # UI kit (ui/), layout shell, and one folder per module
    ├── lib/
    │   ├── db.ts auth.ts realtime.ts concurrency.ts pagination.ts usePaged.ts
    │   ├── accounts/          # costing engine, alerts, ledger, formatting
    │   ├── assistant/         # tool registry, Groq client, guard rails, summaries
    │   ├── production/ quality/ alerts/ approvals/ validation/
    │   └── offline-queue.ts   # IndexedDB queue and idempotent replay
    └── proxy.ts               # route protection (Next.js 16 "proxy", formerly middleware)
```

## Performance and scale

ThreadLine is tested against a database with 500+ orders, 1,100+ work orders and ~1,500
rolls:

- **Every list is paged.** Large lists (orders, rolls, QC queue, work orders, audit trail,
  costing, invoices, dispatch history) are paged by the server; the rest page on the client.
  No page renders more than 50 rows at once.
- **Lean payloads.** Screens request only what they show — for example the dispatch screen
  loads a slim roll view (≈220 KB instead of 720 KB) and pickers load labels only.
- **Lazy loading.** The QR scanner (jsQR + camera), the QR label (qrcode), the command menu
  and the WhatsApp preview load the first time they are opened.
- **One round trip per query.** Prisma runs on the `pg` driver adapter, so queries through
  Supabase's transaction pooler take one network round trip instead of ~5.
- **Batched background work.** Production alerts are refreshed with one read and one bulk
  write, inside a serialised write queue, so they never stall other writes.
- **Realtime without polling.** Clients refetch only the data a live event touched.

## Security

- Server-side role checks on every API route and page; the public surface is limited to
  sign-in, the buyer tracking page (unguessable token), the health check and the signed
  WhatsApp webhook.
- Passwords hashed with bcrypt; session tokens are random 256-bit values stored only as
  SHA-256 hashes; cookies are HTTP-only, `SameSite=Lax`, `Secure` in production.
- Password changes require the current password, are rate-limited, sign out every other
  device, and are audited without the password.
- Socket.IO connections require a live session.
- All input validated with Zod; Prisma parameterises every query (the assistant never
  writes SQL).
- Money and stock writes are transactional and idempotent (client mutation IDs), so retries
  and double-clicks cannot double-charge, double-dispatch or oversell.
- Secrets stay in environment variables; the AI key never reaches the browser.

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `the URL must start with the protocol postgresql://` | `DATABASE_URL` still points at a SQLite file. Use a Postgres URL (see [Getting started](#getting-started)). |
| `EMAXCONNSESSION max clients reached in session mode` | Supabase's session pooler is full. Use the transaction pooler (`:6543`, `pgbouncer=true`) for `DATABASE_URL`, lower `connection_limit`, or raise the pool size in Supabase. |
| Prepared statement errors (`26000`) on Supabase | Add `pgbouncer=true` to a `:6543` URL. |
| Live updates don't arrive | Start with `npm run dev` / `npm run start` (they run `server.js`), not `next dev`. |
| `EADDRINUSE` on start | Another process holds the port; stop it or set `PORT`. |
| Assistant says "Answered without the model" | `GROQ_API_KEY` is missing or the model is unreachable; answers still come from real data. |
| A month's attendance can't be edited | Its wage payout was approved, which locks the muster for that month. |
| Camera scanner shows an error | The browser needs camera permission (and HTTPS outside localhost); manual entry always works. |

## Further documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, data model, costing maths, realtime, offline sync, concurrency, assistant guard rails.
- [docs/API.md](docs/API.md) — every API route, its methods, roles, conventions and error format.
- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow, conventions and the checks to run before a pull request.
- [SECURITY.md](SECURITY.md) — security model and vulnerability reporting.
- [AI_NOTES.md](AI_NOTES.md) — the build log: what was AI-generated, what humans reviewed and changed, and known gaps, module by module.
- [design/stitch/README.md](design/stitch/README.md) — the executive dashboard design reference.

## Team

Built for the **Odoo × NMIT Hackathon** by:

| Area | Owner |
|---|---|
| Foundation, inventory & purchase, orders and the buyer portal | Chezhil |
| Production — machines, work orders, floor board, insights | Naman Raghav |
| Quality, dispatch, QR labels and offline/PWA | Aditya |
| Accounts, owner dashboard, alerts, audit trail, AI assistant, app shell and integration | Devacharan |

The project was built with AI pair-programming; [AI_NOTES.md](AI_NOTES.md) records, module
by module, what was generated, what was reviewed and changed by hand, and what is still open.
