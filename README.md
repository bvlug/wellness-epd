# Wellness EPD

A small **EPD (Elektronisch Patiëntendossier)** for a wellness clinic, built as a proof of
concept. See [`CLAUDE.md`](./CLAUDE.md) for the full stack, architecture, and conventions, and
[`docs/requirements`](./docs/requirements) for the functional requirements and backlog.

## Stack

TypeScript (strict) · Next.js (App Router) · Convex (backend + DB) · Clerk (auth) ·
Biome (lint + format) · Vitest (tests) · pnpm.

## Prerequisites

- Node.js 20+ (LTS)
- pnpm 11+
- A Convex account (`npx convex dev` provisions a dev deployment)
- A Clerk application (publishable + secret keys, and a JWT template named `convex`)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in the values (see below)
```

### Environment variables

All required variables are documented in [`.env.example`](./.env.example):

| Variable | Where it comes from |
|----------|---------------------|
| `NEXT_PUBLIC_CONVEX_URL` | Printed by `npx convex dev`; the deployment URL. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys. |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys. |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk JWT template (`convex`) issuer URL. Read by `convex/auth.config.ts`. |

The `CLERK_JWT_ISSUER_DOMAIN` value must also be set on the Convex deployment so the backend
can verify Clerk tokens:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
```

The admin user/role screen (`app/admin/users`) is backed by a Convex action that calls the
Clerk Management API server-side, so `CLERK_SECRET_KEY` must **also** be set on the Convex
deployment (it is read from the Convex env, never shipped to the browser):

```bash
npx convex env set CLERK_SECRET_KEY sk_...
```

## Local development

Run both processes side by side:

```bash
pnpm dev          # Next.js frontend → http://localhost:3000
npx convex dev    # Convex backend, live-syncing functions/schema
```

## Quality gates

```bash
pnpm lint         # Biome: lint + formatting
pnpm format       # Biome: write formatting fixes
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest (run once)
pnpm test:watch   # Vitest (watch mode)
pnpm build        # next build (production build)
```
