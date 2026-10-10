# AI_NOTES.md

Each module appends its own section below. Don't edit another module's section.

---

## Module 1 — Foundation, Inventory/Purchase & Orders/Buyer Portal (Chezhil, Claude)

### What AI generated
Nearly all of it: the Next.js bootstrap, the full Prisma schema, shared libs
(`db.ts`, `auth.ts`, `audit.ts`, `realtime.ts`, `tokens.ts`), the shared UI
component library, the app shell (sidebar/bottom tabs/breadcrumbs), inventory
(yarn types, yarn lots, suppliers, low-stock alert), orders (CRUD, status
machine, feasibility check, yarn reservation, GST invoice generation), the
public buyer tracking page, and the seed script.

### What a human reviewed/changed
- **Tech stack deviation from the written contract**: the contract (and the
  other three agents' prompts) says "Next.js 14". `create-next-app@latest`
  actually installed **Next.js 16.4.0**, which ships a new "Cache Components"
  model that is a real breaking change from Next 14/15 — pages/layouts that
  read `cookies()` or hit the DB directly now need `export const instant =
  false` or they fail to build. I hit this for real (`npm run build` failed on
  `/accounts`), diagnosed it, and fixed it rather than silently shipping a
  broken build. **If you're Module 2/3/4 and add a new page/layout that reads
  the session or queries Prisma directly (not through a client-side
  `fetch`), add `export const instant = false;` to it or your build will
  fail the same way.** Also: `middleware.ts` is deprecated in Next 16 in
  favor of `proxy.ts` exporting a function named `proxy` — already renamed,
  don't recreate `middleware.ts`.
- **Prisma CLI**: `npm install prisma` pulled **8.0.0-rc.22**, a total rewrite
  into a cloud-platform-deploy CLI with no `migrate dev`/`generate` commands
  in the form the contract assumes. Pinned both `prisma` and
  `@prisma/client` to **5.22.0** (classic CLI) instead — `npx prisma migrate
  dev` and `npx prisma studio` work as documented. Don't bump these without
  checking the CLI still behaves like the classic one.
- **Realtime**: Socket.io needs a long-lived server, which plain `next dev`/
  `next start` don't provide. Added a custom `server.js` (Node, CJS
  intentionally) that boots Next and attaches `socket.io` to the same HTTP
  server, and changed `dev`/`start` npm scripts to run it instead of
  `next dev`/`next start`. `src/lib/realtime.ts` and `src/lib/useRealtime.ts`
  are the only sanctioned way to emit/listen — don't open a second socket.io
  server.
- **Bug found via actual browser testing, not just type-checking**: the
  reservations list in the order detail page crashed
  (`Cannot read properties of undefined (reading 'name')`) because
  `GET /api/orders/:id` included `reservations.yarnLot` but not the nested
  `yarnLot.yarnType`. Fixed the Prisma `include`. This only surfaced by
  actually clicking through the app in a browser — `tsc --noEmit` and
  `next build` both passed with the bug still in place.
- **Lint**: `eslint-config-next` on Next 16 enforces new React Compiler
  rules (`react-hooks/set-state-in-effect`, `react-hooks/refs`,
  `react-hooks/immutability`) that flagged real, if subtle, bugs — a ref
  mutated during render, a `setState` called synchronously inside a
  `useEffect`'s call stack, and a variable reassigned during a `.map()`
  render. Fixed all three (see `src/lib/useApi.ts`, `src/lib/useRealtime.ts`,
  `src/components/layout/Breadcrumbs.tsx`) rather than suppressing the rule.
- Verified end-to-end in a real browser (not just `tsc`/`next build`): login
  for all 4 seeded roles' redirect targets, inventory stock/intake/suppliers
  tabs, order creation with the feasibility check (correctly reports
  `DEADLINE NOT REALISTIC` when 0 machines exist yet — real computed data,
  not an invented answer), yarn reservation, order status transitions
  (blocked `IN_PRODUCTION` until yarn reserved, confirmed), GST invoice
  generation (math checked by hand: ₹47,500 subtotal → ₹49,875 total at 5%),
  and the public no-login tracking page. Also checked the mobile (375px)
  layout.

### Known gaps / honest status
- `Machine` table is empty until Module 2 seeds it, so every feasibility
  check will report `DEADLINE NOT REALISTIC` until then — this is correct
  behavior (real data, zero machines), not a bug, but it'll look alarming in
  a demo before Module 2 merges.
- Assumed fabric width of 1.5m for the yarn-needed formula in
  `src/lib/feasibility.ts` — flagged in the file itself, change it there if
  the mill's actual loom width differs.
- GST rate is a flat 5% constant in `src/lib/billing.ts` — swap for the real
  slab if it differs by fabric/HSN code.
- Placeholder pages exist for every other module's nav destination
  (`src/components/layout/ModulePlaceholder.tsx`) purely so the sidebar
  doesn't 404 before you merge — delete the placeholder usage once your real
  page lands at the same route, don't build around it.

---

## Production module (Naman / Codex)

- Generated production validation schemas, API routes, floor board, machine and work order screens, rule-based delay/reorder insights, and a production seed section.
- Reviewed the supplied module brief, build spec, and three-page problem statement before implementation.
- The repository's `main` branch contained no app scaffold, Prisma schema, package manifest, auth helper, realtime emitter, audit helper, design tokens, or shared UI components at implementation time. Module code assumes `db` from `src/lib/db.ts`, `getSession` from `src/lib/auth.ts`, `emit` from `src/lib/realtime.ts`, and the documented `logAudit` signature. These imports must be checked against the foundation when it lands.
- The three screens currently use native form elements and semantic CSS variables (`--color-status-running`, `--space-4`, etc.). Replace the native controls with the foundation's shared UI components and map the CSS variable names to its tokens during integration.
- The production seed is exported as `seedProduction(db)` so the foundation's seed runner can call it after seeding orders and users. It is idempotent for machine names and order/stage work orders.
- Added `PATCH` and `DELETE` on `/api/machines/:id` to satisfy the brief's explicit machine CRUD requirement. These two verbs are beyond the condensed API path list and need team agreement before merge.
- Alerts refresh after machine status, work order, or production log writes. A scheduled refresh is needed if alerts must change solely because time passes.
- Yarn usage estimates use the last seven days of weaving output and each order's reserved kilograms per metre. This is a rule-based estimate because the schema has no direct yarn-consumption log.
- Syntax parsing passed for all 19 TypeScript files. A TypeScript check against temporary shared-interface stubs caught and fixed a production-log response error; it now passes. Isolated behavior checks passed for validation, India-day boundaries, delay-risk and reorder calculations. No human review or app/DB integration test has occurred yet; the shared foundation is still absent.

---

## Module 3 — Quality, Dispatch, QR & Offline/PWA
**Owner:** Aditya (Antigravity)
**Branch:** `feature/quality-dispatch`

### What was generated with AI
- **Prisma Schema & Migrations**: Defined and pushed initial relational SQLite schema strictly adhering to the shared contract (`Roll`, `QCRecord`, `Dispatch`, `Invoice`, etc.).
- **Design Tokens & Shared UI System**: Created `src/lib/tokens.ts` (defining status colors: green/pass/running, amber/idle/rework, red/breakdown/reject, slate/pending) and shared component library (`Button`, `Input`, `Select`, `Table`, `Badge`, `Card`, `Drawer`, `EmptyState`).
- **Validation Schemas (Zod)**: Built `src/lib/validation/roll.ts` and `src/lib/validation/dispatch.ts` with strict server-side rules:
  - Rejection/rework requires at least one defect (`hole`, `colour_mismatch`, `uneven_weave`).
  - Truck number formatting and non-empty roll selection.
- **Rolls & QR System**:
  - Implemented `GET /api/rolls`, `POST /api/rolls`, `GET /api/rolls/:id`, and `GET /api/rolls/by-qr/:token`.
  - Built `RollQrLabel.tsx` with printable mill label (`window.print()` / `@media print` layout) and offline QR canvas encoding unguessable `qrToken`.
  - Built `QrScannerModal.tsx` dual-mode scanner: real-time camera feed using `jsQR` with zero external CDNs, plus manual/barcode-gun entry.
  - Built roll detail page `src/app/(quality)/rolls/[id]/page.tsx` showing full lineage (order, machine, shift, yarn lot, QC history, dispatch status).
- **Quality Control**:
  - Implemented `POST /api/rolls/:id/qc` with atomic transaction, audit logging (`logAudit`), and realtime event emission (`emitRealtime`).
  - Built responsive floor QC queue `src/app/(quality)/qc/page.tsx` with inspection drawer, defect checklist, and instant status updates.
- **Defect Root-Cause Analytics**:
  - Implemented `GET /api/analytics/defects` computing rejection rates by machine, shift, yarn lot, and defect type from real database records.
  - Generated plain-language, query-driven callouts (e.g. `"Airjet Loom 4 (Faulty Cam) produced 71% of all rejects this period"`).
  - Built analytics dashboard `src/app/(quality)/defects/page.tsx` with KPI cards, risk tags, and distribution tables.
- **Dispatch & Truck Loading**:
  - Implemented `POST /api/dispatches` enforcing server-side rules: only PASS rolls, buyer match, and absolute prevention of double-dispatch (rolls with `dispatchId` are permanently locked).
  - Integrated GST invoice generation (18% GST calculation).
  - Built `src/app/(quality)/dispatch/page.tsx` with roll selector, QR scan onto truck, and dispatch history.
- **Offline-First & PWA**:
  - Built generic offline queue `src/lib/offline-queue.ts` using IndexedDB (`idb`) with client-generated UUIDs for idempotent background sync on reconnection.
  - Built `Header.tsx` with real-time sync-status indicator (`Online`, `Offline`, `Syncing (n pending)`).
  - Configured PWA `manifest.json`, icon, and service worker `sw.js` for app shell caching.
  - Implemented SQLite database export (`GET /api/backup`) and import (`POST /api/restore`).
- **Demo Seed Data**:
  - Seeded 67 realistic rolls in `scripts/seed.ts` with intentional defect clustering on Loom 4 to demonstrate live root-cause analytics.

### What was reviewed / changed by hand
- Verified that all write endpoints return `400` with `{ fieldErrors: { ... } }` on validation failures.
- Checked that double dispatch is blocked at the database query level (`r.dispatchId !== null` check in transaction).
- Confirmed print styling ensures QR roll labels render properly on standard label printers without UI clutter.
- Tested offline fallback logic to ensure mutations queue smoothly when `navigator.onLine` is false or network fails.

---

## Module 4 — Accounts, Owner Dashboard, Alerts, Audit Trail & Local AI Assistant (Devacharan, Claude)

### What AI generated
All of Module 4: the accounts/HR APIs and screens (workers, attendance muster,
expenses, buyer payments, month-end summary), the cost-per-order/per-roll
engine, `GET /api/analytics/{cost-per-order,profit-month,machine-output}`,
the owner dashboard, the notification bell + notification centre with the
WhatsApp-style preview, the audit trail page, the Ollama-backed assistant,
the Module 4 seed (`scripts/seed-accounts.ts`), and three verification
scripts. Generated with Claude (Claude Code); pending Dev's review.

### Where it sits
- Branch `feature/accounts-ai`, cut from **Module 1's `feature/inventory-orders`**
  (the shared foundation: schema, auth, `logAudit`, realtime, UI kit, app shell),
  because `main` still has no app code. So it inherits Module 1's documented
  **Next.js 16** deviation (see Module 1's notes), not Next 14.
- Pages live under Module 1's `(app)` shell and replace its placeholders at
  `/dashboard`, `/accounts`, `/alerts`, `/assistant`; new `/accounts/*` sub-pages
  and `/audit`. Server-side role checks: everything is owner-only except alerts.

### Changes outside Module 4's own folders (flag for review)
- `prisma/schema.prisma` + migration `accounts_ai_additive` — two additive fields:
  `Invoice.createdAt @default(now())` (an invoice date is needed to book profit in
  a month; defaulted, so Module 1's invoice code needs no change) and
  `Expense.note String?` (bill no./vendor).
- `src/app/(app)/layout.tsx` — notification bell in the header, and `min-w-0` on
  the content column so wide tables scroll inside their card on phones instead of
  widening the whole page (this also fixes the same issue on other modules' pages).
- `src/components/layout/nav-config.ts` — added an owner-only "Audit trail" item.
- `scripts/seed.ts` — one clearly marked block calling `seedAccounts(db)` last.
- API routes beyond the contract list, all additive: `GET/POST /api/workers`,
  `PATCH/DELETE /api/workers/:id`, `PATCH /api/alerts` (mark read/unread),
  `GET /api/audit` (read-only).
- Seed cross-write: Module 1's seed creates no invoices, so for DISPATCHED/CLOSED
  orders **without** an invoice the Module 4 seed creates one using Module 1's
  `computeInvoiceTotals` and `INV-YYMM-NNNN` pattern, so payments have something
  to be recorded against. It never touches an order that already has an invoice.
  Remove this once Dispatch creates invoices in the merged seed.

### How the numbers are computed (`src/lib/accounts/costing.ts`)
- **Yarn**: Σ roll.weightKg × that roll's lot `costPerKg` (rejected rolls included —
  their yarn was consumed) + **8% process wastage** (same default as the feasibility check).
- **Direct wages**: an attendance mark on machine M on day D is charged to the orders
  M produced for on D, split by metres logged. Marks with no machine, or on a machine
  that produced nothing that day, are **indirect labour**.
- **Power / overhead / indirect labour**: each month's unlinked bills are spread over
  that month's machine-shifts (one ProductionLog machine × IST day × shift = 1 unit).
  If a month has no production, the pool is reported as **unabsorbed** and deducted
  in that month's P&L instead of being lost.
- **Direct bills**: expenses linked to an order.
- Unlinked `yarn` bills (stock purchases) and `wages` bills (payroll payouts) are not
  spread, so nothing is counted twice; they still show in the month's cash view.
- **Revenue** = qty × price per metre (contract). Profit is **booked in the month of
  the order's first invoice**; uninvoiced orders show cost to date only.
- Every order carries `dataGaps` (no rolls yet, no production logged, no power bill
  for a month) so the UI and assistant say what's missing instead of implying ₹0 is real.

### Assistant guard rails (`src/lib/assistant/`)
- The model (Ollama, server-side only) picks one of 11 fixed read-only tools and
  fills its arguments as JSON; tool name and arguments are validated with zod, with
  one retry. It never writes SQL.
- It then phrases the answer from the tool's JSON only. **Every number in its answer is
  checked against the query result**; if any number isn't there, its wording is
  discarded and a deterministic summary of the same data is returned, with a notice.
- If Ollama is down or the model isn't pulled, a keyword router picks the tool and the
  deterministic summary answers, clearly labelled "Answered without the model".
- Config: `OLLAMA_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL`
  (default `llama3.1:8b`), `OLLAMA_TIMEOUT_MS`.

### Verified (actually run, not assumed)
- `npx tsc --noEmit`, `npm run lint`, `npm run build`: clean.
- `npx tsx scripts/verify-costing.ts`: 42/42 hand-computed figures match on a fixture
  mill (allocation splits, unabsorbed month, per-roll costs summing to the order).
- `node scripts/verify-accounts-api.mjs` against a running server: 53/53 (role
  checks, every validation rule, attendance upsert not duplicating, worker delete
  blocked by history, payment can't exceed balance even with two concurrent requests,
  every order's cost lines sum to its total).
- `npx tsx scripts/verify-assistant.ts`: 23/23 against a scripted stand-in for Ollama's
  `/api/chat` (whitelist, retries, invented-number rejection, offline fallback, router).
- Integration run with teammates' real seed data: Module 3's seed + Module 2's
  `seedProduction` + this seed, then every screen in a real browser at 1366px and
  390px, plus 11 form flows (expense, payment over-pay error, attendance save,
  worker validation, costing drawer, assistant, audit). No page errors.

### Known gaps / honest status
- **No real local model was run**: this build environment can't download Ollama
  models. The pipeline is tested against a stand-in; how well a given model picks tools
  still needs a run with `ollama serve` + `ollama pull llama3.1:8b` on a laptop.
- `/api/analytics/defects` is Module 3's and isn't on this base, so the dashboard's
  quality panel shows "not live yet" until it merges (handled, not an error).
- Notifications have one shared `read` flag (schema has no per-user read state).
- Wage history isn't versioned: changing a worker's daily wage re-prices their past
  attendance too (warned in the edit form).
- Module 2's seed logs a whole work order's output in one log, so some machines show
  output above rated capacity; the dashboard labels that "over rated" rather than a %.
- `feature/quality-dispatch` (Module 3) bootstrapped its own Next 14 app; merging it
  with Module 1's Next 16 foundation will need the team to pick one.

---

## Integration — all four modules on `integration/final` (Devacharan, Claude)

Merged `feature/inventory-orders` (via `feature/accounts-ai`), `feature/production`
and `feature/quality-dispatch` into one branch. Module 1's foundation wins every
conflict (Next 16, zod 4, Tailwind 4, Prisma 5.22, shared schema, auth, realtime,
UI kit); the other modules were adapted to it. No teammate's feature was removed.

### Module 2 (production) changes
- `src/lib/production/auth.ts` used `getSession`, which the foundation doesn't
  have; it now uses `getCurrentUser` with the same owner/floor-supervisor rule.
- Screens moved from the `(production)` group to `(app)/production/*`, the URLs
  the nav and `ROLE_HOME` already used, replacing Module 1's placeholders, with
  a tabbed, role-gated layout. Machines got a tab (it had no nav entry).
- Realtime listened on `io()` (default path); the foundation's server is on
  `/api/socketio`, so the hook now uses the shared `useRealtimeEvent`.
- `production.css` variables (`--space-4`, `--color-status-running`, …) didn't
  exist anywhere; they are now defined on `.production-page` from the
  foundation palette.
- Audit entries were `JSON.stringify`-ed before `logAudit`, which stringifies
  again; they now pass objects so the audit trail diff shows fields.
- `machines/[id]` routes await `params` (Next 16 build failed otherwise).
- `seedProduction` moved to `scripts/seed-production.ts`, called from the main seed.

### Module 3 (quality/dispatch) changes
- Module 3 was a separate Next 14 / React 18 / zod 3 / Tailwind 3 app with its
  own `auth.ts`, `realtime.ts`, `audit.ts`, `tokens.ts` and UI kit. Kept the
  foundation's versions; Module 3's UI kit (different props, e.g. compound
  `Table`) lives on under `src/components/quality/ui/` for its pages.
- Pages moved to `/quality/qc`, `/quality/rolls`, `/quality/rolls/:id`,
  `/quality/defects` and `/dispatch` inside the app shell. `/qc`, `/rolls`,
  `/rolls/:id` and `/defects` redirect (next.config) so old links and printed
  QR labels still work; new labels encode `/quality/rolls/:id`.
- **No API route checked the session or role.** Added: rolls read = any
  signed-in user; mint roll = owner/floor/QC; QC = owner/QC; dispatch =
  owner/storekeeper; defect analytics = owner/QC; backup and restore = owner
  only (backup hands out every password hash; restore replaces the DB).
- QC took `inspectorId` from the form (a hard-coded "QC-INSP-01" list); it is
  now the signed-in user, and roll detail shows the inspector's name.
- Dispatch invoiced at 18% GST on dispatched metres; Module 1's rule (and its
  `POST /api/invoices`) is 5% on order qty × price via `computeInvoiceTotals`
  and `generateInvoiceNo`, so dispatch now uses those. The dispatch preview
  shows the same rate.
- Dispatch marked an order DISPATCHED only when *every* roll shipped, so one
  rejected roll blocked it forever; rejected rolls are now ignored. Rolls are
  re-claimed inside the transaction (`dispatchId: null, qcStatus: PASS`) so
  two trucks can't take the same roll; status changes are audited and emitted
  after commit.
- Roll creation now checks the work order belongs to the order and that the
  machine and lot exist, and skips roll numbers already taken.
- zod 4: `errorMap` → `message`. Next 16: `params` awaited, `export const
  dynamic` removed (incompatible with Cache Components).
- React Compiler lint errors fixed (setState in effects, use-before-declare in
  `QrScannerModal`; online status via `useSyncExternalStore`). The ~40
  `no-explicit-any` hits in Module 3 files are warnings via a scoped override
  in `eslint.config.mjs` — typing them is a follow-up for Module 3.
- The header (`Header.tsx`) became `SyncStatus`: the offline sync pill and
  queue drawer sit in the app header; Backup/Restore show only for the owner.
- QR-label print CSS hid everything else on *every* print; it is now scoped to
  a body class set only while a label prints (Month-end Print works again).
- Service worker paths updated; one failing pre-cache no longer aborts install.
  `manifest.json`, `icon.svg`, `sw.js` are public in `proxy.ts`.
- Module 3's seed wiped the whole DB and created its own users and orders.
  `scripts/seed-quality.ts` rebuilds the same story on the shared data:
  82 rolls, Loom 4 behind 7 of 10 rejects (70%), three trucks gone with
  invoices, 12 PASS rolls waiting, pending rolls in the QC queue. Every roll
  comes from a weaving work order with production logs, so costing and
  machine output line up.

### Shared changes
- `realtime.ts`: added `RollCreated`, `QcCompleted`, `DispatchCompleted`.
- `/production` and `/quality` redirect to their first tab (breadcrumbs linked
  to them and 404'd).
- `.env.example` was ignored by `.env*` and missing; added and un-ignored.
- Module 4 seed: expenses and crew scaled to the seeded mill's real output
  (10 workers; power/rent/AMC reduced), otherwise every order showed a 60%
  loss purely from demo numbers. Thin margins remain, and Loom 4's rejects
  visibly cost money — that is the data, not a tuning target.

### Verified (on a fresh `npm run seed`)
- `tsc --noEmit`, `npm run lint` (0 errors), `npm run build` pass.
- `scripts/verify-costing.ts` (fixture), `verify-assistant.ts`,
  `verify-accounts-api.mjs`, `verify-module3.ts`.
- New `scripts/verify-integration.mjs`: role gating on every module, then one
  order through reserve yarn → work order → production log → roll → QC →
  two trucks → DISPATCHED → invoice → costing final → audit → assistant.
- Browser (Playwright, headless Chromium): every page for all four roles at
  1366px and 390px with no console/page errors, no 4xx/5xx and no horizontal
  overflow; UI flows for add machine, record output (owner's floor board
  updates live over the socket), QC reject with defect validation, loading a
  truck, and the dashboard/payments/audit views of the result.

### Still open
- Ollama never ran for real here (model registry blocked); assistant was tested
  against a mock and the keyword fallback.
- Offline queue + service worker were not exercised offline in a browser.
- Order QC → READY is still a manual status change (Module 1's order page).
- Module 1's `npm run seed` is not idempotent (re-running duplicates
  suppliers/buyers/orders); reset the DB before re-seeding.

---

## Data Import — scan handwritten registers + SQL file import (Chezhil, Claude)

New post-integration feature, not part of the original 4-way split: a
request to bring in legacy records (handwritten stock/attendance/order
registers, and simple SQL dumps from an old system) without hand-retyping
them. Owner-only, under `/import`.

### What AI generated
Essentially all of it:
- `src/lib/import/sql-parser.ts` — a small hand-rolled parser for
  `CREATE TABLE` / `INSERT INTO ... VALUES (...), (...);` statements (not a
  full SQL grammar on purpose — real small-business dumps are simple, and a
  mis-parse of something exotic is worse than refusing to parse it).
- `src/lib/import/targets.ts` — the four supported record types (yarn
  intake, attendance, expenses, orders), each resolving related records by
  name (supplier/buyer/worker/yarn type) and creating them if new, rather
  than requiring the person to already have ids.
- `src/lib/import/ocr.ts` + an extension to `src/lib/assistant/ollama.ts`
  (`ollamaVision` / `OLLAMA_VISION_MODEL`) — sends a photo to a local
  multimodal model (default `llava`, separate from the text assistant's
  `llama3.1`) with a register-specific prompt, parses the JSON rows back out.
- Three new API routes (`sql-parse`, `ocr`, `commit`) plus a read-only
  `targets` route, and the `src/components/import/*` review UI (editable
  grid, column-mapping with best-effort auto-guessing, per-row commit
  results) — both the photo path and the SQL path land in the same review
  grid and the same commit endpoint before anything touches the database.

### What a human reviewed/changed
- Grounded the design in a web search first (see conversation) rather than
  guessing register formats: confirmed real Indian mill attendance registers
  follow Form IX / Form IV shapes (name, shift, daily status, wages) and that
  "simple SQL files" in this space realistically means arbitrary
  `CREATE TABLE`/`INSERT` dumps with varying column names — which is why the
  importer is a generic mapper rather than one hardcoded schema.
- The first version of the column auto-mapper used substring matching on
  concatenated field names and missed real cases (`qty_kg` → "Quantity
  received (kg)", `received_on` → "Date received") because the words were in
  different positions. Rewrote it as token-set overlap with a small synonym
  table (qty→quantity, no→number, etc.) after verifying the failure in the
  browser, not just by reading the code.
- Verified end-to-end for real, not just type-checked: parsed a sample
  legacy `yarn_stock` SQL dump through the UI into a real new YarnType
  ("Cotton 40s — Cream", 275.5kg across 2 lots) visible on the Inventory
  page; committed attendance/expense/order rows via the API directly,
  including common register shorthand (`P`/`HD`/`A` for status, `A`/
  `Morning` for shift) and a mixed batch of valid/invalid rows to confirm one
  bad row doesn't block the others; confirmed non-owner and unauthenticated
  requests get 403/401; confirmed every import shows up in the Audit Trail
  tagged "Import" so it's distinguishable from a manual entry.
- Could not test the photo-scanning path against a real model: this
  environment has Ollama installed but only a text model (`llama3.2:3b`), no
  vision model. Verified the failure path instead — `ollamaVision` correctly
  reports `Model "llava" is not installed in Ollama. Run: ollama pull llava`
  rather than hanging or crashing, both from the lib function directly and
  through the actual API route (503 with that message). **Before relying on
  the scanner, pull a vision model** (`ollama pull llava`, or set
  `OLLAMA_VISION_MODEL` to another multimodal model you have) **and test it
  against a real photo of a register** — the JSON-extraction prompt in
  `src/lib/import/ocr.ts` has never been validated against actual model
  output, only against the "model missing" error path.

### Known gaps / honest status
- The SQL parser handles typical dumps but not every SQL dialect quirk
  (e.g. MySQL `ON DUPLICATE KEY UPDATE`, multi-row `INSERT ... SELECT`,
  stored generated columns). It skips what it can't parse and reports a
  warning rather than guessing.
- New supplier/buyer records created implicitly during import get a
  placeholder contact ("Unknown (imported)") — worth a follow-up pass in
  Suppliers/Orders to fill in real contact details.
- No dedupe beyond exact case-sensitive name match on resolve-or-create;
  "Himalaya Yarns" and "himalaya yarns" would currently become two suppliers.
