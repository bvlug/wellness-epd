# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What we are building

A small **EPD (Elektronisch Patiëntendossier / electronic patient record)** for a wellness
clinic, built as a **proof of concept**. It still handles patient-shaped data, so privacy is
treated as a first-class concern (see Domain & privacy below).

MVP scope:
- **Patiëntbeheer** — create, search, and view patient profiles with their base data.
- **Afspraken / agenda** — schedule appointments and view the treatment calendar.
- **Behandelingen** — record treatments and per-patient treatment history.

## Stack & decisions

| Concern         | Choice                                                        |
|-----------------|---------------------------------------------------------------|
| Language        | TypeScript (strict)                                           |
| Frontend        | Next.js (React, App Router)                                   |
| Backend + DB    | Convex — reactive database + serverless functions             |
| Authentication  | Clerk (integrated with Convex and Next.js)                    |
| Deployment      | Vercel (frontend) + Convex Cloud (backend/database)           |
| Package manager | pnpm                                                          |
| Testing         | Vitest                                                        |
| Lint / format   | Biome (replaces ESLint + Prettier)                            |

**Convex replaces a traditional API server and ORM** — there is no separate Fastify service
and no Drizzle/SQL layer. All data access and business logic live in Convex functions
(queries / mutations / actions). The Next.js frontend talks to Convex through the Convex
React client; it never reaches a database or a hand-rolled REST API.

## Architecture

- **Convex is the backend.** `convex/schema.ts` defines the data model; `convex/*.ts` files
  export `query`, `mutation`, and `action` functions. These are the only place data is read
  or written. The frontend calls them via `useQuery` / `useMutation`.
- **Clerk is the identity provider.** Auth is wired through `ConvexProviderWithClerk`, and
  Convex trusts Clerk via `convex/auth.config.ts` (Clerk JWT template). Convex functions read
  the caller's identity with `ctx.auth.getUserIdentity()` and must authorize on that — do not
  assume an authenticated user; check it.
- **Vercel hosts the Next.js app; Convex Cloud hosts the backend.** They deploy separately.
  The frontend needs the Convex deployment URL and Clerk keys as environment variables.

## Intended layout

```
app/             Next.js App Router (UI; uses the Convex React client)
components/       React components
convex/
  schema.ts      Convex data model — single source of truth for the database
  *.ts           queries / mutations / actions (all data access lives here)
  auth.config.ts Clerk ↔ Convex auth configuration
```

## Commands (target — valid once scaffolded)

The repo is not scaffolded yet; these are the intended commands. Once `package.json` exists,
treat its actual scripts as authoritative over this list.

```bash
pnpm install            # install deps

pnpm dev                # run the Next.js frontend (next dev)
npx convex dev          # run Convex locally and live-sync functions/schema (run alongside dev)

npx convex deploy       # deploy Convex backend to Convex Cloud
npx convex dashboard    # open the Convex dashboard (inspect data, logs)

pnpm lint               # Biome: check lint + formatting
pnpm format             # Biome: write formatting fixes
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest: run all tests
pnpm test <path>        # Vitest: run a single test file
pnpm test --watch       # Vitest: watch mode
```

> Local development needs **both** `pnpm dev` and `npx convex dev` running. Vercel deploys the
> frontend; the Convex backend is deployed separately via `npx convex deploy`.

## Issue tracking

Issues for this repository are tracked on **GitHub** (GitHub Issues). Epics and user stories
produced for this project should live there.

## Domain & privacy

Even as a POC, treat the data model as real patient data (AVG/GDPR mindset):

- **Never log, print, or include patient-identifying data** (names, contact details,
  behandelinhoud) in logs, error messages, test fixtures, or commit messages. Use anonymized
  or synthetic data for tests and examples.
- All patient data access goes through **Convex functions that authorize the Clerk identity**.
  No unauthenticated function should return patient data.
- **Data residency — production blocker to resolve later.** Convex Cloud runs on AWS (often
  US-based). For real patient data this is an AVG concern. Acceptable for the POC; before any
  production use with real patients, an EU/region strategy must be decided. Do not treat this
  as solved.

## Conventions

- TypeScript `strict` everywhere. Derive types from the Convex schema rather than duplicating
  shapes by hand; validate function arguments with Convex validators (`v.*`).
- The **Convex schema is the source of truth** for the data model. Change the schema, let
  Convex apply it — do not bypass Convex to mutate data.
- Domain terms stay in Dutch where they are the ubiquitous language (`patient`, `afspraak`,
  `behandeling`) — do not translate them to English mid-codebase.
- **Language of artifacts**: internal artifacts are written in **English** (functional
  requirements, epics, user stories, code review, commit messages, PR descriptions);
  **user-facing** artifacts are written in **Dutch** (end-user documentation, release notes).
- Authorize inside every Convex function that touches patient data; never rely on the
  frontend to enforce access.
- **Biome** handles both linting and formatting — do not add ESLint or Prettier. Run
  `pnpm lint` / `pnpm format` and follow Biome's config rather than hand-formatting.
- **Vitest** is the test runner. Use synthetic/anonymized data in fixtures (never real
  patient-identifying data).
