# Intro Mapper

**Live:** https://intro-mapper.vercel.app

A team-wide warm-intro tool. It maps everyone's professional network, then ranks
the best person to make a warm introduction to any target — with a transparent
rubric and honest confirmed-vs-inferred labeling.

It is the web companion to the Chrome extension in this same monorepo and reuses
the `@whop-copilot/shared` workspace package (parsers, identity resolution,
scoring, intro-draft guards).

## What it does

- Ingests each teammate's own platform exports (LinkedIn, X, Instagram) — no
  scraping, no passwords, only user-initiated exports.
- Resolves a target's identity via People Data Labs and finds paths to them.
- Ranks intro-makers with a 5-part rubric (closeness to target, credibility,
  closeness to you, responsiveness, consent).
- Drafts a grounded intro-request ask that can only cite relationships actually
  present in the graph.

## Compliance stance

The tool never scrapes and never collects platform passwords. It uses only:

- User-initiated data exports uploaded by the person who owns them.
- Official OAuth (X) and the LinkedIn EU Data Portability API (Phase 2).
- People Data Labs for identity resolution and coworker-overlap inference only —
  never for connection lists (PDL does not provide them).

Inferred edges (PDL coworker overlap) are always labeled "likely", capped below
confirmed edges, and must clear a higher score bar before they surface.

## Setup

This app is a workspace inside the monorepo. Install once from the **repo root**,
then run the web workspace:

```bash
# from the repo root (linkedin-outreach-copilot/)
npm install
SESSION_SECRET=dev-secret npm run dev:web    # http://localhost:3000

# or from this directory
cd intro-mapper
cp .env.example .env    # set SESSION_SECRET; optionally DATABASE_URL and PDL_API_KEY
npm run dev
```

The app runs with **zero external dependencies** by default: without
`DATABASE_URL` it uses an in-memory store (persisted to `data/store.json` for dev
durability). Set `DATABASE_URL` to a Postgres/Neon instance and run the schema:

```bash
npm run db:migrate      # applies db/schema.sql
```

## Deploying to Vercel

Both the extension and this web app live in one repo. Deploy the web app as a
subdirectory:

1. Import the repo into Vercel and set **Root Directory** to `intro-mapper`.
   Vercel auto-detects Next.js and the npm workspace, installing `@whop-copilot/shared`
   via the workspace symlink — no extra config needed.
2. Add a **Neon Postgres** store from the Vercel Marketplace (sets `DATABASE_URL`
   automatically). The in-memory store does not persist on serverless.
3. Set env vars: `SESSION_SECRET` (required), plus optional `PDL_API_KEY` and
   `X_CLIENT_ID` / `X_CLIENT_SECRET` / `X_REDIRECT_URI` (the redirect must point at
   your Vercel domain, e.g. `https://<app>.vercel.app/api/oauth/x/callback`).
4. Apply the schema once against the Neon database: `npm run db:migrate` with
   `DATABASE_URL` set (locally, or via a one-off Vercel job).

## Environment

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Signs the session cookie. Required in production. |
| `DATABASE_URL` | Postgres connection. Unset = in-memory dev store. |
| `PDL_API_KEY` | People Data Labs key for target identity resolution. Optional; target lookup degrades to manual entry. |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` / `X_REDIRECT_URI` | X OAuth app for follower sync (Phase 2). |

## Architecture

```
app/                 Next.js App Router pages + API routes
  api/               auth, consent, upload, target, intro, team, data/delete
  components/        client UI (Finder, IntroMap, Onboarding, TeamAdmin)
lib/
  shared.ts          re-export of @whop-copilot/shared (workspace package)
  store/             Store interface + in-memory and Postgres implementations
  auth.ts            signed-cookie team auth (swap for Clerk in prod)
  graph-service.ts   load graph, ingest, rank paths, inferred coworker edges
  target-service.ts  PDL / manual target resolution
  ingest.ts          upload -> parser dispatch
db/schema.sql        Postgres schema (org-scoped, tenant-isolated)
```

## Auth

v1 ships a signed-cookie team login (org + email, no password store) so the app
runs without external services. It is the single seam to replace with Clerk: swap
the internals of `signIn`/`getSession` in `lib/auth.ts`; the rest of the app only
depends on `getSession`.

## Reusing the shared package

`intro-mapper` depends on `@whop-copilot/shared` as an npm workspace. The package
ships TypeScript source (`main: src/index.ts`), and `next.config.mjs` lists it in
`transpilePackages` so Next compiles it as part of this app's build. Resolution
happens through the workspace symlink, so it works identically for local `dev`,
local `build`, and Vercel (Root Directory = `intro-mapper`).
