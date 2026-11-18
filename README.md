# Ethiopian Multi-Service E-Commerce Platform

Storefront + private admin dashboard for a business selling **cosmetics**, **electronics** and **printing services** in Ethiopia. Prices in ETB, English & Amharic, manual bank-transfer payments verified by staff, Telegram order alerts.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres, Auth, RLS, Storage) · Zod · next-intl · Vercel

| Document | Purpose |
|---|---|
| [`PROGRESS.md`](PROGRESS.md) | Current status, decisions, open questions, next steps |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture, database design, security model, routes, design system, phased plan |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Local setup, Supabase, first admin, Telegram, Vercel |

## Quick start

```bash
npm ci
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Applies all migrations to a throwaway PostgreSQL and runs the SQL security/flow tests |
| `npm run check` | Lint + typecheck + unit tests + build |

## Repository layout

```
supabase/migrations/   Schema, RLS, business functions, storage (source of truth)
supabase/seed.sql      SAMPLE development data (never for production)
supabase/db-tests/     SQL test suite + local Supabase emulation
src/app/               Routes (storefront + /admin)
src/lib/               env, Supabase clients, auth guards, pricing, validation, security
src/components/ui/     shadcn/ui components
messages/              English & Amharic UI strings
tests/unit/            Vitest unit tests
```
