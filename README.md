# Schedule Management

Standalone, integration-ready scheduling tool for Skiles Group. Import a Microsoft
Project XML schedule into a normalized, versioned Postgres model, capture field
progress through a weekly lookahead update loop, and export the actuals back to
Microsoft Project — all in a mobile-first view.

## Stack
Next.js 14 (App Router), Prisma + PostgreSQL (Neon), Tailwind, Vitest. Deploys to
Vercel (`skiles-group/schedule-manager`).

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` (Neon, pooled) and
   `DIRECT_URL` (Neon, direct — used for migrations), plus `APP_PASSWORD`
   (shared login) and `APP_SESSION_TOKEN` (long random string).
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
8. If the app's checklist flagged any replaced activities, manually delete those
   rows from the schedule now — Project's Unique-ID merge adds and updates tasks
   but never deletes them.

Notes: it is a merge wizard, not a one-click apply (the saved map makes repeat
runs fast). Actual times land at midnight because the update form captures
date-only progress. Confirm the project **Status Date** after merging if you rely
on "reschedule uncompleted work".

## Deployment (Vercel)
- Project `skiles-group/schedule-manager`; the database is Neon, provisioned
  through the Vercel Marketplace integration (which injects `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED` itself).
- `DATABASE_URL` is Neon's **pooled** endpoint (serverless functions open many
  short-lived connections); `DIRECT_URL` is the direct endpoint and is set
  separately, because Prisma needs it for migrations and the integration does not
  create that name. If Neon rotates credentials, re-sync `DIRECT_URL` by hand.
- Also set on the project: `APP_PASSWORD`, `APP_SESSION_TOKEN`, `BASE_PATH`,
  `SKILES_OS_API_BASE_URL`, `SKILES_OS_APP_ORIGIN`. `APP_BASE_URL` is set only
  once the OS proxies `sgconnect.dev/schedule-manager` — before that it would
  redirect users to an unrouted path.
- Migrations are **not** run by the build. Run `npx prisma migrate deploy` against
  Neon on release.
- `.vercelignore` replaces `.gitignore` for uploads, so exclusions must be
  repeated there. It must keep excluding `.env` — that path is a symlink to
  `.env.local` locally, and uploading a dangling link fails `next build`.

## Skiles Group Connect integration

The tool is registered in the OS as `schedule-manager` and is served at
`sgconnect.dev/schedule-manager` by a same-domain proxy rewrite. It still runs
standalone with no OS env vars set — see `.env.example` for the integration set.

- `BASE_PATH` mounts the whole app under its sub-path. Next prefixes `<Link>` and
  router navigation, but **not** raw `fetch()` URLs or `<form action>` — those go
  through `appPath()` in `lib/http.ts`. Route-handler redirects use `appUrl()`,
  which prefers `APP_BASE_URL` so the user stays behind the OS proxy.
- `GET /launch?token=…&returnUrl=…` is the OS handoff: it validates the
  short-lived gateway token by exchanging it for project context, then
  establishes the session. `/api/health` is what the OS health check polls. Both
  are public in `middleware.ts`.
- Session cookies are scoped to `BASE_PATH` so they are not sent to the OS or to
  other tools sharing the domain.

There are two kinds of session, and they are separate cookies on purpose:

- **`sms_scope`** — an OS launch. Signed (HMAC over `APP_SESSION_TOKEN`), 12-hour
  TTL, and names exactly one project, so it both authenticates and scopes. The
  launch upserts a local project against the OS project id (`Project.osProjectId`,
  unique) and redirects into it. A scoped session is redirected to its own project
  from anywhere else, and project-scoped API routes answer 403 for any other
  project.
- **`sms_session`** — the shared-password login, kept for standalone and admin
  use. Unscoped, so it still sees every project.

The scope cookie is not layered on top of the shared session: if it were, dropping
it (expiry, or a devtools click) would leave a valid full-access session behind.
Launching clears `sms_session` for the same reason.

Records that capture a human decision — schedule imports, progress updates,
completeness dismissals and splits, trade scope dismissals — store the OS
`personId` taken from the signed scope, never from the request body. Standalone
writes leave it null. Identity cannot be reconstructed after the fact, so it is
captured now even though the tool cannot yet publish it back to the OS.

**Trades data comes from Connect.** The OS is the system of record for a
project's trade partners *and* the disciplines attached to them
(`GET /tool-gateway/trade-partners`). The launch handoff fetches the roster and
caches it in `OsTradePartner`, because a gateway token is only valid for 15
minutes and is spent on the handoff — reading it per request would need a
token-refresh lifecycle this tool does not otherwise need. Each launch replaces
the rows, so removals propagate. A failed fetch never blocks the launch; the
previous roster stands and the next launch retries.

The split of ownership:

- **Connect owns the vocabulary.** A project's disciplines are the union of those
  on its partners; the companies offered for a discipline are the partners
  Connect says cover it. Both are `<select>`s over closed sets, and partners
  flagged do-not-use contribute neither. `assignTradePartner` refuses any partner
  id that is not on the project's cached roster, so a forged id is a no-op.
- **This tool owns the mapping.** `TradeDictionaryEntry` maps a schedule scope to
  a discipline (`osDisciplineId`), which Connect cannot do — it has no idea that
  "hang drywall L2" is drywall work. The mapping stays global so it transfers
  across projects.

Assignments key on `osDisciplineId` / `osPartnerId` and keep a `partnerName`
snapshot. They are deliberately **not** a foreign key to `OsTradePartner`: that
cache is replaced wholesale at each launch, and a real relation would
cascade-delete every assignment whenever someone opened the tool. Reads prefer
the live roster name and flag a partner that has left the project.

There is no local partner list or discipline vocabulary any more. A project never
launched from Connect has no trades data, and the Trades tab says so.

**Publishing to the OS is blocked at the OS, not here.** The Tool Gateway's
`activity-events` and `telemetry-events` writers are retired stubs
(`toolGatewayWriteService.ts` throws `retiredToolGatewayWriteSyncMessage`, and
`toolGatewayRoutes.ts` returns 503 for them on the Postgres runtime), so no
activity event can be delivered by any tool today. `task-requests` does work, but
requires the `tasks` capability, which this tool's manifest does not request.
Emission is deliberately not built against a dead endpoint; the linkage it would
need is in place.

Still open before the OS can flip this tool to `lifecycle: "active"`: the
`vercel.ts` rewrite, `SCHEDULE_MANAGER_ORIGIN`, and the frontend launch allowlist
— all OS-repo changes. See `docs/tool-building/EXTERNAL_TOOL_GO_LIVE.md` §5.

## Roadmap
See `docs/superpowers/specs/2026-06-17-schedule-management-slice1-design.md` for
the full vision and the six-slice roadmap (lookahead + weekly update loop,
export, more importers, normalization/analytics, proactive reminders).
