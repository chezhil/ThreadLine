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
