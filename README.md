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

## Notes

- Realtime (Socket.io) needs the custom `server.js` entrypoint, already wired
  into `npm run dev` / `npm run start` — don't swap in plain `next dev`.
- Next.js 16 + Prisma 5.22 pinned on purpose — see `AI_NOTES.md` for why.
