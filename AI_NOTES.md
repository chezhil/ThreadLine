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
- UPDATE (post-deploy): swapped from a local Ollama model to a cloud API —
  deploying to Railway means there's no machine running `ollama serve` next to the
  app anymore, and the whole point of this module is to degrade gracefully when the
  model is unreachable, which Ollama's local-only nature made true by default in
  every deployed environment. Went through two providers: first Gemini
  (`gemini.ts`), then swapped again to Groq (`groq.ts`) since Gemini was reserved
  for a possible future image/document-scanning feature (not built — no such
  feature exists in this app) and Groq answers this app's plain-text tool-routing
  and summary calls faster and more reliably on a free-tier key. `engine.ts`
  updated each time, same interface throughout. Everything below describes the
  design, which didn't change — only which API it calls.
- The model (Groq, server-side only — the browser never sees the API key) picks
  one of 11 fixed read-only tools and fills its arguments as JSON; tool name and
  arguments are validated with zod, with one retry. It never writes SQL.
- It then phrases the answer from the tool's JSON only. **Every number in its answer is
  checked against the query result**; if any number isn't there, its wording is
  discarded and a deterministic summary of the same data is returned, with a notice.
- If Groq is unreachable, unconfigured, or the model name is wrong, a keyword
  router picks the tool and the deterministic summary answers, clearly labelled
  "Answered without the model".
- Config: `GROQ_API_KEY` (required — without it the assistant runs in keyword-only
  mode), `GROQ_MODEL` (default `openai/gpt-oss-120b`), `GROQ_TIMEOUT_MS`.

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

### Post-integration hardening
- Shared auth now stores random hashed session tokens in the additive `Session`
  model; the old user-ID cookie was forgeable. Login creates a seven-day session,
  logout revokes it, and protected routes reject expired or missing sessions.
- The Windows custom server selects Webpack in development because Turbopack's
  Prisma externalization needs junction creation, which can be denied by Windows
  sandbox policies. Production build behavior is unchanged.
- A PR verification workflow now runs migrations, seed, static checks, a
  production build, signed-in page and socket smoke checks, and every module's
  verification script on Linux. Local
  production bundling was blocked by Windows sandbox file permissions.
- `npm audit --omit=dev` reports no production dependency vulnerabilities.
  The full audit reports five high findings through the development-only
  `eslint-config-next` → `braces` chain; npm currently offers no non-breaking
  fix for that chain.

### Still open
- Ollama never ran for real here (model registry blocked); assistant was tested
  against a mock and the keyword fallback.
- Offline queue + service worker were not exercised offline in a browser.
- Order QC → READY is still a manual status change (Module 1's order page).
- Module 1's `npm run seed` is not idempotent (re-running duplicates
  suppliers/buyers/orders); reset the DB before re-seeding.

---

## Concurrency safety (Chezhil, Claude)

Prompted by the user: "two people can't book the last seat" (a ticket-
booking concurrency pattern) applied to this app — two supervisors
reserving the same yarn lot, two scans dispatching the same roll, two
concurrent requests numbering the same invoice. Full write-up of this and 7
related hardening items in `../HARDENING_ADDENDUM.md`; this section covers
only what got built: item 1 of that file.

### What AI generated
- `src/lib/concurrency.ts` (`withRetry`) and the fix itself: moved
  `reserve-yarn`'s stock check inside its transaction (was reading
  `qtyRemainingKg` before the transaction that decremented it), gave
  `generateOrderNo`/`generateInvoiceNo` an optional transaction-client
  parameter so the count-then-format happens inside the same `db.$transaction`
  as the row it numbers, and folded the dispatch route's invoice
  find-or-create into its existing roll-claiming transaction (it previously
  ran before that transaction, unprotected).
- `scripts/verify-concurrency.ts` — fires real concurrent HTTP requests at a
  running server for all three paths and asserts the DB ended up consistent.

### What a human reviewed/changed
- **Found the dispatch/invoice bug by reading the code, not by assumption**:
  Module 3's roll-claiming inside `db.$transaction` was already correct
  (atomic `updateMany` + affected-count check — the right pattern). But its
  invoice find-or-create sat *before* that transaction, unprotected. Read
  the actual file before fixing anything, rather than assuming "transactions
  are used somewhere so it's probably fine."
- **Proved the bugs were real, not hypothetical, before claiming a fix**:
  temporarily reverted the three route files to `main`'s original versions,
  reran the exact same test script, and confirmed it failed concrete and
  ugly — yarn stock went to **-50kg** across 5 concurrent reservations of a
  100kg lot, and 8 concurrent invoice requests for one order produced **4
  duplicate invoices** (the other 4 crashed with unique-constraint 500s).
  Then restored the fix and confirmed the same script now passes 11/11 on a
  fresh seed. Both runs are reproducible with the commands in the addendum.
- `withRetry`'s retry condition is narrow on purpose (Prisma error codes
  P2002/P2034 and SQLite's "database is locked") — it must not retry a
  legitimate business rejection like insufficient stock, which the code
  checks for explicitly (`InsufficientStock` is re-thrown immediately, not
  retried).

### Known gaps / honest status
- `withRetry`'s correctness here rests on SQLite serialising concurrent
  write transactions from one process; this has not been tested against a
  Postgres deployment, where the isolation-level defaults and conflict
  errors differ.
- Items 2-8 of the addendum (split order status, an immutable ledger,
  approval workflows, the rest of the failure-case matrix, an alerts
  outbox, a load test, backup/restore round-trip test, CSV export) are
  scoped in detail but **not built** — see the addendum for why each one was
  judged too invasive to rush blind into a shared branch, and what order to
  tackle them in.

---

## Order status split (Chezhil, Claude)

Item 2 of `../HARDENING_ADDENDUM.md`. Branched from `feature/concurrency-
safety` (merged in first) rather than `main`, since this touches the same
`dispatches`/`invoices` write paths item 1 just fixed — building on the
unfixed version would have reintroduced that race or duplicated the fix.

### What AI generated
- Migration adding `productionStatus`/`qcStatus`/`dispatchStatus`/
  `paymentStatus` to `Order`, with a best-effort SQL backfill from the
  legacy `status` value for any pre-existing rows (can't know about partial
  dispatch/payment from `status` alone — real data gets a proper recompute).
- `src/lib/order-status.ts`: `deriveStatus()` (pure function, legacy
  `status` from the four granular fields) plus one apply/recompute helper
  per real-world event — production started/completed, QC result changed,
  a dispatch happened, a payment was recorded — each meant to be called from
  inside the caller's own transaction.
- Rewired every write site: `work-orders`, `production-logs`,
  `rolls/:id/qc`, `dispatches`, `payments`, and the `orders/:id` PATCH
  endpoint (cut down to only `NEW→CONFIRMED` and `DISPATCHED→CLOSED`).
- `scripts/verify-order-status.ts` (21 checks) and a backfill pass added to
  the end of `scripts/seed.ts` (all four seed scripts write Order fields
  directly via Prisma, never through the API, so the granular fields would
  otherwise sit at their schema defaults regardless of how far along each
  seeded order actually is).

### What a human reviewed/changed
- **Audited before touching anything**: grepped every `order.status` write
  site across all four modules' merged code before designing the schema,
  rather than guessing at the blast radius. That audit is what surfaced the
  two bugs the user asked to fix in the same pass — `work-orders/route.ts`
  and `production-logs/route.ts` both wrote `status` directly, bypassing
  whatever validation lived in the PATCH endpoint.
- **Found a third issue while fixing those two, not assumed**: reading the
  PATCH endpoint closely showed it had no precondition checks at all for
  QC/READY/DISPATCHED — an owner could "Advance" an order straight to
  DISPATCHED with zero rolls produced, inspected, or shipped. Removed that
  manual path entirely rather than patching around it.
- **First test run caught real bugs in the test, not the feature**: the
  initial `verify-order-status.ts` run failed 6 of 21 checks. Traced each
  one before concluding anything: "machine already has an active work
  order" was the test reusing a seeded machine that was already busy, not a
  product bug — fixed by creating a dedicated machine per run.
  "dispatchStatus should be FULLY_DISPATCHED but stayed PARTIALLY_DISPATCHED"
  turned out to be correct behavior — the seeded order the test picked still
  had REWORK rolls sitting un-dispatched, which correctly blocks
  "fully shipped." Rewrote sections C/D to use fully self-contained roll
  fixtures (2 PASS + 1 REJECT, created directly, to also prove REJECT
  doesn't block completion) instead of depending on fragile shared seed
  state. Reran clean: 21/21.
- **Verified the QC aggregation live, not just via the script**: logged in
  as owner, found a real order with one inspected + one pending roll via a
  direct DB query, called `POST /api/rolls/:id/qc` against the running
  server for the pending one, and confirmed via a fresh DB read that
  `Order.qcStatus` flipped from `PENDING` to `PASS` only once *both* rolls
  were inspected — not after the first one, which would have been wrong.
- Checked the UI after the backend, not instead of it: logged into `/orders/
  :id` and confirmed the four badges render with sensible colours (added
  `not_started`/`in_production`/`done`/`needs_rework`/`not_dispatched`/
  `partially_dispatched`/`fully_dispatched`/`unpaid`/`partial`/`paid` to the
  shared `statusColor` token map in `src/lib/tokens.ts` — they'd have all
  silently rendered grey otherwise, since unrecognised keys fall back to
  grey by design) and that the "Advance" button correctly disappears once
  there's nothing left for a person to manually do.

### Known gaps / honest status
- The seeded demo data has a pre-existing cross-script looseness this
  surfaced but didn't cause: several orders seeded as already `DISPATCHED`/
  `CLOSED` have `productionStatus` recomputed to `IN_PRODUCTION` rather than
  `DONE`, because `scripts/seed-production.ts`'s `WorkOrder` rows for those
  orders were never marked fully `COMPLETED`, independently of what
  `scripts/seed-quality.ts` did with their rolls. The recompute pass reports
  this honestly (it derives from real rows, so it can't paper over it) —
  worth reconciling in a seed-data pass, not a product bug.
- No explicit "dispatched quantity exceeds order.qtyMetres" check — dispatch
  is still bounded by which `Roll` rows exist for the order, not by a
  metres comparison. Flagged in the addendum's failure-case matrix (row 2).
- `paymentStatus` reads directly from `Payment`/`Invoice` sums rather than
  from item 3's (not-yet-built) ledger — noted in the addendum as the thing
  to point at the ledger once it exists, so there's one source of truth for
  money figures instead of two.

## Bug-fix pass on `main` (Devacharan, Claude) — local branch `fix/main-followups`, not pushed

Branch made from `origin/main` (7401973). Naman's `origin/feature/production`
(revocable session table + CI workflow) is merged in rather than rewritten.
Every change below was run against a fresh database (`prisma migrate deploy`
+ seed + production build).

**What was broken and is now fixed**

- Concurrent writes: SQLite deferred transactions deadlocked and returned 500
  after 5 s; writes now go through one in-process queue that takes the write
  lock first (`writeTransaction` in `src/lib/concurrency.ts`).
- Sessions: the cookie was the raw user id (and user ids were visible in roll
  reads and socket events), so anyone could sign in as the owner. Naman's
  random-token session table is now in; roll reads and socket payloads no
  longer carry user ids; the realtime socket needs a live session.
- Offline queue posted replays to `http://localhost:3000` in the browser; it
  now uses the app's own origin, is scoped to the signed-in user, keeps
  401/403 items until that user signs in again, replays oldest first, shows
  failed items with Retry/Discard, and the online attempt and the offline
  fallback share one `clientMutationId` (no duplicates when a request dies
  mid-flight). The server only accepts a replayed id for the same roll /
  buyer (409 otherwise).
- Production: completing spinning marked the whole order done (QC) and then
  blocked weaving. Production is DONE only when dyeing completes. A part
  shipment while production runs is PARTIALLY_DISPATCHED, not DISPATCHED.
  READY needs at least one PASS roll (all-REWORK/REJECT orders stay in QC and
  no "ready" alert fires with nothing to ship). Every derived status change
  (QC→READY, payments, production) is audited and broadcast.
- Roll minting: the form sent the order id as the work order id and only
  offered machines/lots from existing rolls. New `GET /api/rolls/mint-options`
  feeds it; the API forces PENDING, checks weaving WO / its loom / the
  order's yarn, rejects NEW/CONFIRMED/CLOSED orders, and numbers rolls inside
  the write transaction.
- QC racing a dispatch could re-grade a shipped roll (now conditional
  update); unknown defect ids are rejected; late offline inspections keep
  their real time and don't override a newer grade.
- Dispatch of rolls from several orders invoiced only the first order; every
  order now gets its invoice. GST preview used the first roll's price.
- Restore overwrote the live file in place after a header check; it now
  validates integrity, migration version and an owner account on a copy, then
  swaps atomically under the write lock. Backup uses `VACUUM INTO`.
- Module 4: costing called an order "final" as soon as any invoice existed
  (now: fully dispatched/closed, booked in the month of its last truck);
  raising a wage rewrote past months (attendance now stores the day's wage);
  concurrent muster saves could double-mark (unique worker/day/shift); one
  user's "mark all read" cleared everyone's alerts (per-user read marks);
  the assistant read "margin" as March and "decrease" as December.
- Smaller: low-stock alerts piled up (one per yarn type now, cleared on
  refill), reservations against closed orders or another order's lot,
  invoices for NEW orders, future intake dates, feasibility summed every
  machine instead of the bottleneck stage, date-only deadlines were 05:30
  IST, forms stuck on "saving" after a non-JSON error, mobile tabs linked
  pages the role can't open and phones had no sign-out, machine delete
  ignored attendance, tracking page showed nothing for CLOSED.

**Migrations added:** `20261010100000_alert_delivery_outbox`,
`20261010110000_wage_snapshot_and_user_reads` (plus Naman's
`20261010090000_revocable_sessions`).

**Checks run on this branch** (fresh DB each): tsc, lint (0 errors),
build, verify-runtime (incl. socket refuses anonymous), verify-integration
65/65, verify-accounts-api 53/53, verify-order-status 30/30,
verify-concurrency 11/11, verify-costing, verify-assistant, verify-module3,
test-offline-sync, test-backup-restore, and the Playwright tours (every role on desktop and phone: no console errors, 4xx/5xx or overflow; flows; offline QC + dispatch replay exactly once).

**Known gaps:** seeded IN_PRODUCTION orders have no yarn reservation (the
mint check accepts a lot the order's earlier rolls used); floor supervisors
may mint rolls via the API but the Quality pages are owner/QC only; the
service worker can still cache a page a role is denied until sign-out
clears it; the alert outbox has no caller yet.

---

## Hardening addendum cleanup pass (Claude, via Claude Code)

Picked up several of the addendum's smaller 🟡/⬜ items and the lowest-effort
half of item 8's readiness checklist — the ones scoped small enough to do in
one pass without the blast radius of items 3 (ledger) and 4 (approval
workflows), which the addendum itself flags as full units of work on their
own and are deliberately left alone here.

### What AI generated
- **Item 6, alert outbox — wired, not just built.** `src/lib/alerts/
  outbox.ts` (`enqueueAlert`/`processAlertOutbox`) existed from the prior
  session's schema migration but had zero call sites — nothing ever enqueued
  a row. Wired `enqueueAlert` into the two buyer-facing events the spec
  actually cares about ("tell a buyer where their order stands… without
  anyone having to go and look"): `rolls/:id/qc` route when `recomputeQcStatus`
  returns a transition to `READY`, and the `dispatches` route when
  `recomputeDispatchStatus` returns a transition to `DISPATCHED`. Added
  `GET /api/alerts/outbox` and `POST /api/alerts/outbox/process` (both
  owner-only), a standalone poller (`scripts/alert-worker.ts`, `npm run
  alerts:worker`) so delivery actually drains with retry/backoff instead of
  sitting PENDING forever, and a "Delivery outbox" panel in
  `AlertsClient.tsx` (hidden for non-owner roles, since the API 403s them)
  with a "Process now" button. Two new `statusColor` tokens added
  (`sent`/`retrying`/`failed`) — additive, nothing existing changed.
- **Addendum item 5, row 2 — over-dispatch guard.** `dispatches/route.ts`
  now checks, per distinct order in a dispatch batch and inside the same
  transaction that claims rolls, that already-dispatched + this-batch roll
  lengths don't exceed `order.qtyMetres × 1.05` (5% tolerance, same idea as
  the process-wastage allowance elsewhere) — rejects with the exact
  would-be-shipped vs. ordered figures rather than silently over-shipping.
  `OverDispatchError` isn't in `withRetry`'s retryable set, so it surfaces
  immediately as a business rejection, not retried.
- **Addendum item 5, row 6 — payment idempotency.** `paymentSchema` gained
  an optional `clientMutationId`, used the same way Roll QC and Dispatch
  already use theirs: the payment is created with that id, and a retried
  submission with the same id gets the existing payment back instead of
  recording the money twice.
- **Item 8, CSV export.** `GET /api/accounts/month-end/export?month=YYYY-MM`
  (owner-only), reusing `computeCosting`/`monthSummary` as the addendum
  suggested — per-order cost breakdown plus the summary block, as a
  downloadable CSV. "Export CSV" button added next to "Print" on the
  month-end page.
- **Item 8, load test.** `scripts/load-test.ts` (`npm run loadtest`) — no
  autocannon dependency, plain `fetch` + `Promise.all` firing concurrent
  reads at `/api/orders`, cost-per-order, machine-output and alerts for a
  configurable duration, reporting error rate and latency percentiles.
  (Health check and the backup/restore round-trip test, the other two item-8
  entries, turned out to already exist from the prior session —
  `src/app/api/health/route.ts` and `scripts/test-backup-restore.ts`.)

### What a human (via Claude Code) reviewed/verified
- **Found the outbox was dead code by grepping for callers, not by
  assumption**: `grep -rl "outbox"` across `src/app/api` turned up nothing,
  confirming the table and functions from the prior session's migration had
  no write path pointing at them yet.
- **Every change tested live against the running dev server, not just
  compiled**: `npx tsc --noEmit` and `npm run lint` both clean (pre-existing
  `any`-type errors in `outbox.ts` and the two `test-*.ts` scripts are from
  the prior session, confirmed untouched by this pass).
- QC-passed 8 real pending rolls on order EVR-2610-005 (a genuine, realistic
  use of the feature, not a fabricated fixture) to drive a real `READY`
  transition, confirmed via `GET /api/alerts/outbox` that a `WHATSAPP`/
  `order_ready` row was queued with the buyer's real contact and tracking
  path, then clicked "Process now" in the UI and confirmed it flipped to
  `SENT`.
- Over-dispatch guard: created one temporary 300m roll on EVR-2610-005 (1031m
  already produced vs. 1100m ordered, 1155m limit), QC-passed it, attempted
  to dispatch all 11 PASS rolls (1331m) and confirmed a 400 with the exact
  would-be/ordered figures in the message — then deleted the temporary roll
  and its QC record directly via Prisma to restore the real demo data
  untouched.
- Payment idempotency: posted the same `clientMutationId` twice against a
  real open invoice, confirmed both responses returned the identical payment
  row and the outstanding balance only dropped once (not twice) — then
  deleted the test payment and called `recomputePaymentStatus` directly to
  restore the invoice's original `PARTIAL` state.
- CSV export: fetched it live, confirmed `Content-Type: text/csv`, the
  `Content-Disposition` filename, and that the per-order rows and summary
  totals matched what the month-end page already shows.
- Load test: ran `LOAD_DURATION_MS=3000 LOAD_CONCURRENCY=10 npx tsx
  scripts/load-test.ts` against the live dev server — 1190 requests, 0
  errors, p99 40ms.

### Known gaps / honest status
- Items 3 (immutable ledger) and 4 (approval workflows) remain 🟡, not
  built, exactly as the addendum scoped them — both are explicitly
  full-module-sized units of work touching multiple modules' write paths,
  not something to bolt on in the same pass as the smaller items above.
- Addendum item 5's two ⬜ rows are still open: offline QC entry conflicting
  on sync (needs a "needs attention" surface in `src/lib/offline-queue.ts`,
  not just a test), and this pass's own payment idempotency only guards a
  client-supplied `clientMutationId` match — a duplicate submission with no
  id, or a *different* id for the same real-world event, isn't caught (that's
  what item 3's ledger would ultimately generalize).
- `enqueueAlert` only fires on two events (order READY, order DISPATCHED).
  The addendum's own low-stock/machine-breakdown derived alerts
  (`syncDerivedAlerts`) are owner-facing in-app notifications only — not
  wired to the outbox, since those aren't buyer-facing and don't need a
  WhatsApp push.
- `deliverAlert` is still a simulator (same honesty the addendum asked for
  item 6: "build the right shape, not real delivery now") — a recipient
  containing "invalid" or exactly "simulate-failure" fails on purpose to
  exercise the retry path; everything else "succeeds" without calling any
  real provider. The UI says this explicitly.

---

## Hardening integration (Devacharan, Claude) — branch `integration/hardening`

Merges Chezhil's hardening work on `main` (ledger, approvals, offline QC
conflicts, alert outbox, month-end CSV) with the bug-fix pass above, then
tests both together. Conflicts were resolved by keeping both behaviours:
payments post a ledger entry *and* audit/broadcast the payment-status change;
dispatches raise one invoice per order on the truck, each posting revenue to
the ledger, keep the over-dispatch guard, and queue the buyer's "dispatched"
alert inside the dispatch transaction; QC checks `baseQcStatus` and recomputes
the order's roll aggregates. The local duplicate AlertDelivery migration was
dropped because `main` already ships one.

**Bugs found in review or testing, now fixed**

- Approving was check-then-update: two clicks (or two owners) could both
  approve, and a payout approved twice recorded the month's wages twice.
  Decisions are now a conditional `PENDING → …` update under the write lock;
  the loser gets 409.
- Payout totals were frozen when raised. Approving now re-reads the month's
  attendance; if it changed, the request is refreshed and the owner is asked
  to approve the new figure. Future months and months with no wages are
  refused, and a rejected month can be raised again (it was blocked forever
  by the unique month).
- Duplicate requests: one open purchase request per yarn type and one open
  maintenance request per machine. The owner is notified of new requests and
  everyone sees the decision in Alerts. A maintenance cost is kept only when
  the repair is approved.
- `POST /api/invoices` created invoices without a ledger entry, so the
  ledger and payment status disagreed for invoice-before-dispatch orders.
- Deleting a machine with a maintenance request was a 500 (foreign key); it
  is now the usual 409 "has history".
- `?limit=abc` on the ledger and outbox APIs was a 500; now 400.
- The Alerts page asked every role for the owner-only outbox (a 403 and a
  console error on every visit). The outbox card is rendered for the owner
  only, and "Process now" shows failures.
- Payment idempotency: a reused `clientMutationId` for a different invoice
  returned the other payment; two simultaneous replays of one id hit the
  primary key and returned 500. Both are handled (409 / the first payment).
- Month-end CSV: UTF-8 BOM so Excel shows names correctly; text that would
  run as a spreadsheet formula is neutralised.
- Approvals UI ignored server errors and allowed double submits; it now
  disables while saving, shows the reason for a refusal, has a repair cost
  field, raised/decided dates and per-tab pending counts, and refreshes live.
  Inventory's "Request more" shows errors and the quantity requested.
- QC page: a 409 now shows the roll's current grade, so saving again is a
  deliberate override rather than another conflict.
- The owner had no way to reach Approvals on a phone; the dashboard now
  shows "N approvals waiting for you" linking to it.

**Tests**: `scripts/verify-hardening.ts` (new, 89 checks: ledger posting and
idempotency, concurrent approvals, payout refresh, conflicts, dispatch alert,
CSV, and database invariants — every invoice/payment/expense has exactly one
matching ledger entry and every order's payment status matches the ledger),
all earlier verify/test scripts, Chezhil's `test-offline-conflict` and
`load-test`, and Playwright: every page for every role on desktop and phone,
the end-to-end flows, offline replay, and the approvals/ledger/conflict UI.

**Still open**: alerts are only sent when the owner clicks "Process now" or
`npm run alerts:worker` runs (no real WhatsApp/SMS provider); costing still
reads Payment/Expense rows rather than the ledger (they agree, the invariant
check proves it); purchase approval doesn't create a yarn lot (by design —
stock is added when the yarn arrives).

---

## CRUD, reverse-and-correct and archiving (Devacharan, Claude) — branch `feature/crud-and-final-verification` (IN PROGRESS, not merged)

Goal: every mistyped record can be corrected from the app. Backend is complete
and tested; UI is about two-thirds done. **Not merged to `main`** — the live
Ollama checks and the Playwright pass were not run yet (see "Handoff").

### Decisions (and why)
- **Append-only money and QC via a `Reversal` table** (migration
  `20261010123916_reversals_and_archiving`). Payments, expenses, invoices and QC
  inspections are never edited or deleted. Reversing inserts one `Reversal`
  row (unique FK per record, `ON DELETE RESTRICT`) and, for money, a reversing
  `LedgerEntry` via `reverseLedgerEntry` in the same `writeTransaction`
  (`src/lib/reversals.ts`). A correction is a new row in the same transaction,
  linked by `Reversal.replacementId`. Chosen over a `reversedAt` column so the
  rows themselves are truly insert-only.
- **Every reader skips reversed rows** with the shared `notReversed` filter:
  costing, month summary, payments/expenses lists (reversed rows shown flagged,
  excluded from totals), assistant tools, defect analytics, machine quality, QC
  "newer inspection" check, invoice find-or-create (dispatch and "Generate
  invoice"), `recomputePaymentStatus`. Reports are therefore the *as-corrected*
  view; the ledger keeps the dated trail.
- Invoice "correct" = credit note + re-issue at a corrected price per metre (the
  order's price follows, trucks re-point to the new invoice). Refused while
  unreversed payments exist on it — reverse those first.
- QC "correct" = reverse the inspection (roll falls back to its latest remaining
  grade or PENDING, order aggregates recomputed, READY buyer alert re-queued via
  the shared `queueOrderReadyAlert`), then inspect again normally.
- A wage-payout expense can't be reversed (its approval stands on it). A month
  whose payout was **approved locks its attendance** (muster save and mark
  delete return 409) — otherwise wages and the paid bill disagree.
- **Archive instead of delete** for records with history: `archivedAt` on Buyer,
  Supplier, YarnType, Worker. Archived = hidden from new-work pickers and
  refused by create APIs; existing links keep working; restorable. Archived
  yarn types never raise low-stock alerts. Machines are not archivable yet.
- Deletes of anything in use → 409 with a reason the UI shows as-is
  (`src/lib/in-use.ts`). Counts run inside `writeTransaction`.
- Orders: details editable only while NEW/CONFIRMED (conditional update);
  buyer/qty/price locked while an active invoice exists; changing qty/GSM/
  deadline re-runs the stored feasibility (now also stores wastage %) or clears
  it. Delete only when nothing depends on it; yarn reservations can be released
  before production starts.
- Production: work orders re-planned/re-assigned while unfinished, deleted
  before any output/rolls (order falls back to CONFIRMED). Output entries
  corrected/removed via `src/lib/production/corrections.ts` — completes or
  reopens the work order and, for dyeing, the order's production; refused if a
  later stage already started or the order shipped/closed.
- Rolls: measurements/shift/lot editable until dispatched; never-inspected rolls
  deletable. Dispatch truck number correctable.
- New offline behaviour: corrections, deletes and reversals are **online only**
  by design (replaying a delete or reversal later against changed data is
  unsafe); failures show "Couldn't reach the server".
- Realtime: new `data:changed` event (`emitDataChanged`, ids only).

### Bugs found and fixed on the way
- Order numbers were `count + 1`; with deletes that collides → now max + 1.
- `deriveStatus` fell back to NEW when production was undone → CONFIRMED.
- `postJson` reported network/403/non-JSON failures under `form`, which no form
  read (errors silently swallowed) → `_form`. Added DELETE support.
- `Badge` ignored its label (low-stock card showed "reject"/"pass").
- Assistant tool descriptions, fallback summaries and the Month-end subtitle
  said profit is booked at first invoice; costing books it when the order
  finishes shipping.
- Inputs were unbounded (1 MB names, whitespace-only text, any GSTIN,
  duplicate roll ids on a truck) → bounded/validated in shared schemas.
- Orders/Inventory pages had no role guard; `Drawer` had no dialog semantics,
  Escape or focus handling; field errors weren't linked to inputs.

### Tests
- New `scripts/verify-crud.ts` (178 checks: roles/sessions, hostile input,
  every guard and 409, races — concurrent reversals, corrections, order
  numbers — ledger/payment-status/QC-grade invariants). Shared helpers in
  `scripts/lib/api-check.ts`; reversal-aware ledger invariants in
  `scripts/lib/invariants.ts`, also used by `verify-hardening.ts`.
- Last run (fresh `migrate deploy` + seed, production build, Windows):
  tsc clean, lint 0 errors, build OK; verify-runtime, verify-integration 65/65,
  verify-accounts-api 53/53, verify-costing, verify-assistant (mock),
  verify-module3, verify-hardening 90/90, verify-crud 178/178,
  verify-order-status 30/30, verify-concurrency 9/9, test-offline-sync,
  test-offline-conflict, test-backup-restore all pass.
- **Suite order matters** (pre-existing): hardening approves this month's
  payout, which now locks this month's attendance, so run
  `verify-accounts-api` before `verify-hardening`, or reset the DB between
  them. verify-crud tolerates either order.

### Handoff — what's left
UI done: Inventory (stock/lots/suppliers with edit/archive/delete), Buyers page
(`/orders/buyers`), order create/edit/delete + reservation release + cancelled
invoices + stored feasibility, work-order edit/delete + output-entry
correct/remove, attendance remove-mark + locked-month notice + archived workers
off the muster.

Still to do (APIs exist and are tested; only screens missing):
1. **Payments page**: "Reverse" per payment (reason + optional corrected
   amount/mode/date → `POST /api/payments/:id/reversal`), "Cancel / re-issue"
   per invoice (`POST /api/invoices/:id/reversal`, optional `pricePerMetre`);
   show `reversal` rows flagged. Add a `clientMutationId` to the payment form.
2. **Expenses page**: "Reverse/correct" (`POST /api/expenses/:id/reversal`),
   hide it for `isPayout` rows; muted rows for `reversal`.
3. **Workers page**: Archive/Restore (`PATCH /api/workers/:id {archived}`),
   show-archived toggle.
4. **Roll detail / rolls page** (Module 3, uses `any`): edit roll
   (`PATCH /api/rolls/:id`), delete never-inspected roll, "Reverse" per QC record
   (`POST /api/rolls/:id/qc/:recordId/reversal`, owner/QC) — records now carry
   `reversal { reason, reversedByName }`.
5. **Dispatch page**: truck-number edit (`PATCH /api/dispatches/:id`).
6. Listen for `data:changed` on Payments/Expenses/QC screens.
7. Not started: live Ollama verification (WSL Ollama 0.33.2 with llama3.1:8b
   is reachable from Windows at `http://localhost:11434`; run
   `BASE=… node scripts/verify-assistant-live.mjs`, then the question/attack
   list), Playwright UI flows (none in repo; Chromium 1194 is cached locally),
   add `verify-crud`/`verify-hardening` to `.github/workflows/verify.yml`, then
   merge to `main`.
