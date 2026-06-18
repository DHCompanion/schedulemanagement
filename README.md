# Schedule Management

Standalone, integration-ready scheduling tool for Skiles Group. Import a Microsoft
Project XML schedule into a normalized, versioned Postgres model, capture field
progress through a weekly lookahead update loop, and export the actuals back to
Microsoft Project — all in a mobile-first view.

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

## Weekly updates
Open a project's **Weekly updates** → **New update**, set the as-of date and a
1/3/6-week lookahead window, and record per-activity progress (status, actual
start/finish, % complete). The lookahead also surfaces older not-started and
past-due items so nothing slips. Save the draft as you go, then **Finalize** to
lock it as an immutable, versioned progress snapshot. Updates are cumulative —
the latest finalized value per activity is the "current" progress.

## Exporting updates back to Microsoft Project
The app captures progress but does **not** recalculate the schedule — Microsoft
Project does, when you merge the actuals back in.

1. In the app, open a project → **Export to MS Project** → re-upload the exact
   `.xml` you originally imported (it is hash-matched to that import) → **Generate
   updated file**. You get back `…-updated-<date>.xml` with `ActualStart`,
   `ActualFinish`, `PercentComplete`, and the project `StatusDate` injected into
   the matching tasks; every other field is untouched.
2. In **Microsoft Project**, open the **base schedule** (`.mpp`) so it is the
   active project.
3. **File → Open** → select the `…-updated-<date>.xml`. The Import Wizard launches.
4. Choose **"Merge the data into the active project"** (not *new project* or
   *append*).
5. Set the **merge key to `Unique ID`.** Because the export is the same file you
   imported, Task Unique IDs line up exactly, so the right tasks are updated.
6. Ensure the imported fields include **Actual Start, Actual Finish, % Complete**
   (and Status Date). Save the import map the first time so it is reusable.
7. Finish the wizard — Project applies the actuals and recalculates.

Notes: it is a merge wizard, not a one-click apply (the saved map makes repeat
runs fast). Actual times land at midnight because the update form captures
date-only progress. Confirm the project **Status Date** after merging if you rely
on "reschedule uncompleted work".

## Deployment (Railway)
- Provision a PostgreSQL plugin; set `DATABASE_URL` from it.
- Set `APP_PASSWORD` and `APP_SESSION_TOKEN`.
- Build command `npm run build`, start command `npm start`.
- Run `npx prisma migrate deploy` against the Railway database on release.

## Roadmap
See `docs/superpowers/specs/2026-06-17-schedule-management-slice1-design.md` for
the full vision and the six-slice roadmap (lookahead + weekly update loop,
export, more importers, normalization/analytics, proactive reminders).
