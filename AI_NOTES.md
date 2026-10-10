# AI notes

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
