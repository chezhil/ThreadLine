# Contributing to ThreadLine

## Workflow

1. Branch from `main` (`feature/...`, `fix/...`).
2. Run the app with `npm run dev` (it starts `server.js`, which hosts Socket.IO; don't use plain `next dev`).
3. Before opening a pull request, all of these must pass:

```bash
npx tsc --noEmit
npm run lint          # zero warnings
npm run build
BASE=http://localhost:3000 npx tsx scripts/verify-crud.ts   # plus any verify-* script your change touches
BASE=http://localhost:3000 npx playwright test
```

CI ([`.github/workflows/verify.yml`](.github/workflows/verify.yml)) runs the full suite on every pull request.

## Conventions

- **Next.js 16**: pages/layouts that read the session or query the DB must opt out of static rendering; route protection is `src/proxy.ts` (not `middleware.ts`). Read `node_modules/next/dist/docs/` before using an unfamiliar API.
- **Prisma 5.22 is pinned**; don't upgrade without checking the CLI. Schema changes are additive migrations only.
- **Authorise on the server** in every route (`requireRole`, `productionActor`, `qualityActor`). Validate input with Zod and return `{ fieldErrors }` on 400.
- **Money and stock writes** go through `writeTransaction()`; money is corrected by reversal, never edited.
- **Realtime**: emit through `src/lib/realtime.ts` only; listen with `useRealtimeEvent`.
- **Lists** use the shared `Table` / `usePaged` / `Pager`; large lists page on the server (`src/lib/pagination.ts`).
- **No `any`, no unused imports**: lint must stay warning-free.
- Record notable AI-assisted work in [AI_NOTES.md](AI_NOTES.md).
