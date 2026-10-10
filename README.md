# ThreadLine

Everest Textile Mills — any order, any roll, any rupee, in seconds.

Full product spec: `../everest-mill-build-spec.md`. Per-module build instructions
for the team: `../prompts/`.

## Setup (local, no internet required after install)

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run seed
npm run dev
```

`npm run seed` seeds all four modules in order on a fresh database: Module 1
(users, suppliers, buyers, yarn, orders), Module 2 (machines, work orders,
production logs), Module 3 (rolls, QC, dispatches) and Module 4 (workers,
attendance, expenses, payments). Running it again adds nothing. To start
over: `npx prisma migrate reset`.

Open http://localhost:3000. Seeded demo logins (see `scripts/seed.ts`):

| Role | Username | Password |
|---|---|---|
| Owner | `owner` | `owner123` |
| Storekeeper | `storekeeper` | `store123` |
| Floor supervisor | `floor` | `floor123` |
| QC inspector | `qc` | `qc123` |

## Other scripts

- `npm run db:studio` — browse the database in Prisma Studio.
- `npm run build` / `npm run start` — production build and run.
- `npm run lint` — eslint.
- Checks (start the app on a freshly seeded DB first):
  - `npx tsx scripts/verify-costing.ts` — costing engine against a hand-checked fixture
  - `BASE=http://localhost:3000 node scripts/verify-integration.mjs` — one order through all four modules, plus role checks
  - `BASE=http://localhost:3000 node scripts/verify-accounts-api.mjs` — Module 4 API
  - `npx tsx scripts/verify-assistant.ts` — assistant guard rails (mock Groq)
  - `npx tsx scripts/verify-module3.ts` — Module 3 seed sanity
  - `BASE=http://localhost:3000 node scripts/verify-assistant-live.mjs` — assistant against the real Groq API (prints how many answers the model wrote vs the keyword fallback)
  - `BASE=http://localhost:3000 node scripts/verify-runtime.mjs` — signed-in page shells and Socket.IO (run against `npm run start` after building)
  - `BASE=http://localhost:3000 npx tsx scripts/verify-hardening.ts` — ledger, approvals, offline QC conflicts, outbox alerts, month-end CSV
  - `BASE=http://localhost:3000 npx tsx scripts/verify-order-status.ts` — derived order status (production/QC/dispatch/payment)
  - `BASE=http://localhost:3000 npx tsx scripts/verify-concurrency.ts` — stock reservation, dispatch and invoice numbering under concurrent writes
  - `BASE=http://localhost:3000 npx tsx scripts/verify-crud.ts` — edit/archive/delete/reverse-and-correct across every module (178 checks). Run `verify-accounts-api` before this (or reset the DB between them): it approves this month's wage payout, which locks that month's attendance.
  - `npx tsx scripts/verify-whatsapp-preview.ts` — WhatsApp dispatch message: server-built text, role gate, rate limit
  - `npx tsx scripts/verify-whatsapp-cloud.ts` — Cloud API delivery and the receipt webhook, against a stand-in for Meta's API
  - `npx playwright test` — UI smoke suite, one golden path per module (`playwright.config.ts`, `tests/e2e/`); needs the app already running (`BASE` env, defaults to `http://localhost:3000`). Business-logic coverage lives in the `verify-*` scripts above; these just catch the UI failing to render or wire up to a working API.
- AI assistant: set `GROQ_API_KEY` (get one at https://console.groq.com/keys);
  without it the assistant falls back to keyword routing (see `src/lib/assistant/engine.ts`) — verified with both the model present and absent.

## Notes

- Realtime (Socket.io) needs the custom `server.js` entrypoint, already wired
  into `npm run dev` / `npm run start` — don't swap in plain `next dev`.
- Next.js 16 + Prisma 5.22 pinned on purpose — see `AI_NOTES.md` for why.

## Stitch UI preview

The exported [executive dashboard](design/stitch/README.md) is available at
`/stitch/executive-dashboard/index.html` after signing in.

## WhatsApp

- **Open in WhatsApp** (dispatch page / order page) builds the buyer message on the server and opens a click-to-chat link. It needs no setup.
- **Automatic buyer alerts** (order ready, order dispatched) go through the delivery outbox. With `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set they are sent through the WhatsApp Cloud API (run `npm run alerts:worker`, or use "Process now" on the Alerts page); without them they are simulated.
- **Receipts:** point the Meta app's webhook at `https://<host>/api/webhooks/whatsapp` with `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` set. Delivered/read/failed receipts then show on the outbox card. Requests without a valid `X-Hub-Signature-256` are rejected.
- Meta only allows business-initiated free text inside the 24h window after the buyer last messaged the mill's number; outside it the send fails with Meta's reason on the outbox row. Registering message templates is the next step for production use.
