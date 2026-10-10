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
