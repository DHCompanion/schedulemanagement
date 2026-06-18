# Schedule Management

Standalone, integration-ready scheduling tool for Skiles Group. Slice 1: import a
Microsoft Project XML schedule into a normalized, versioned Postgres model and
verify it in a mobile-first view.

## Stack
Next.js 14 (App Router), Prisma + PostgreSQL, Tailwind, Vitest. Deploys to Railway.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` (Railway Postgres),
   `APP_PASSWORD` (shared login), `APP_SESSION_TOKEN` (long random string).
3. `npx prisma migrate dev` to create the schema.
4. `npm run dev` and open the app; log in with `APP_PASSWORD`.

## Testing
- `npm test` runs the suite. Pure parser/auth tests always run; database and
  `commitImport` tests run only when `DATABASE_URL` is set.

## Importing a schedule
Create a project (capture the minimal profile), then **Import schedule** and
upload an MS Project `.xml` export (File → Save As → XML in MS Project; binary
`.mpp` is not supported). Review the pre-commit preview, confirm the status
(data) date, and commit. Each import is an immutable versioned snapshot.

## Deployment (Railway)
- Provision a PostgreSQL plugin; set `DATABASE_URL` from it.
- Set `APP_PASSWORD` and `APP_SESSION_TOKEN`.
- Build command `npm run build`, start command `npm start`.
- Run `npx prisma migrate deploy` against the Railway database on release.

## Roadmap
See `docs/superpowers/specs/2026-06-17-schedule-management-slice1-design.md` for
the full vision and the six-slice roadmap (lookahead + weekly update loop,
export, more importers, normalization/analytics, proactive reminders).
