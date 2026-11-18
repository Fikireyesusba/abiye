@AGENTS.md

# Project instructions

- Start every session by reading `PROGRESS.md` (status, decisions, next steps) and `docs/ARCHITECTURE.md`.
- Security rules are non-negotiable: never trust browser prices/totals; all money/stock/status changes go through the SQL functions in `supabase/migrations/*_business_functions.sql`; the secret key client (`src/lib/supabase/admin.ts`) is used only after validation + rate limiting; every admin page/action calls `requirePermission()`.
- New tables: enable RLS, revoke from anon/authenticated, add explicit grants + policies, and add tests in `supabase/db-tests/`.
- New DB error codes: add to `src/lib/errors.ts` and both `messages/*.json` (enforced by tests).
- Before finishing: `npm run check` (lint, typecheck, unit tests, build) and `npm run test:db`; then update `PROGRESS.md`.
