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
attendance, expenses, payments). To start over: `npx prisma migrate reset`.

Open http://localhost:3000. Seeded demo logins (see `scripts/seed.ts`):

| Role | Username | Password |
|---|---|---|
| Owner | `owner` | `owner123` |
| Storekeeper | `storekeeper` | `store123` |
| Floor supervisor | `floor` | `floor123` |
| QC inspector | `qc` | `qc123` |

## Other scripts

- `npm run db:studio` — browse the SQLite DB in Prisma Studio.
- `npm run build` / `npm run start` — production build and run.
- `npm run lint` — eslint.
- Checks (start the app on a freshly seeded DB first):
  - `npx tsx scripts/verify-costing.ts` — costing engine against a hand-checked fixture
  - `BASE=http://localhost:3000 node scripts/verify-integration.mjs` — one order through all four modules, plus role checks
  - `BASE=http://localhost:3000 node scripts/verify-accounts-api.mjs` — Module 4 API
  - `DATABASE_URL=file:./dev.db npx tsx scripts/verify-assistant.ts` — assistant guard rails (mock Ollama)
  - `npx tsx scripts/verify-module3.ts` — Module 3 seed sanity
- AI assistant: install [Ollama](https://ollama.com) and `ollama pull llama3.1:8b`;
  without it the assistant falls back to keyword routing.

## Notes

- Realtime (Socket.io) needs the custom `server.js` entrypoint, already wired
  into `npm run dev` / `npm run start` — don't swap in plain `next dev`.
- Next.js 16 + Prisma 5.22 pinned on purpose — see `AI_NOTES.md` for why.
