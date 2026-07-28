# Proposed corrections to `docs/tool-building/` (OS repo)

Findings from building `schedule-manager` against the Tool Gateway. Every claim
below was checked against `backend/src/core/toolGateway/` on 2026-07-28, not
against the docs.

**The problem in one line:** the docs state that the activity-event and telemetry
write layers have shipped. They have not — both are stubs that throw. A tool
builder who trusts the docs will plan work that cannot run.

**Status: applied.** These landed in the OS repo as PR #215
(`docs/gateway-implementation-status`), together with a CI guard that fails the
build when the docs and the gateway code disagree. Kept here as the record of how
the gaps were found.

---

## Verified status (the evidence behind every edit)

| Endpoint | Implementation | Guard |
|---|---|---|
| `POST /tool-gateway/launch-sessions` | real | Postgres |
| `POST /tool-gateway/refresh-session` | real | — |
| `GET /tool-gateway/session` | real | — |
| `GET /tool-gateway/project-context` | real | — |
| `GET /tool-gateway/trade-partners` | real | Postgres |
| `GET /tool-gateway/tool-capabilities` | real | — |
| `POST /tool-gateway/task-requests` | real | capability `tasks` |
| `POST /tool-gateway/activity-events` | **throws** `retiredToolGatewayWriteSyncMessage` | 503 before it on Postgres |
| `POST /tool-gateway/telemetry-events` | **throws** `retiredToolGatewayWriteSyncMessage` | 503 before it on Postgres |
| `POST /tool-gateway/context-requests` | real | per-packet |

Sources: `toolGatewayRoutes.ts` (route table, 503 gates at 169/195),
`toolGatewayWriteService.ts:77-91` (the two throwing stubs),
`toolGatewayContextService.ts:48-56` (`supportedPacketTypes`).

Context packets: `project_task_summary`, `project_activity_summary`,
`daily_log_candidate_summary`, `daily_log_report_summary`, and
`constraint_project_summary` return real data. `qaqc_project_summary` and
`weekly_scheduling_constraint_summary` deliberately return empty/unavailable
packets. `project_schedule_summary` **is not a supported packet type** despite
being declared as a dependency by a shipped manifest (`moduleRegistry.ts:885`).

---

## Edit 1 — `TOOL_INTEGRATION_CONTRACT.md:345` (highest priority)

**Current**

> The current gateway layer supports scoped reads, task requests, activity event
> writes, safe telemetry writes, and approved summary context packets. It does not
> add raw table access, production auth, external registry persistence, persistent
> session tables, database migrations, or tool extraction.

**Proposed**

> The current gateway layer supports scoped reads, task requests, and approved
> summary context packets.
>
> **Not available:** `activity-events` and `telemetry-events` are retired stubs.
> `createToolGatewayActivityEvent` and `createToolGatewayTelemetryEvent`
> (`toolGatewayWriteService.ts`) throw, and the routes return 503 on the Postgres
> runtime before reaching them. No tool can publish an activity event or telemetry
> event today. Declare `emittedEvents` and a `dailyReportPolicy` so the contract is
> ready, but do not build emission against these endpoints — see the status table
> below for what is actually callable.
>
> It also does not add raw table access, production auth, external registry
> persistence, persistent session tables, database migrations, or tool extraction.

*Why:* this sentence is the one a builder reads to decide what to build. It is
currently wrong on two of five items.

---

## Edit 2 — `README.md:42` (§3 Q0, Track B)

**Current**

> The gateway now supports **reads and writes**: launch sessions, project context,
> and capability reads, plus task-request, activity-event, and telemetry writes and
> OS-mediated cross-tool context packets (the read, write, and context layers have
> all landed).

**Proposed**

> The gateway supports launch sessions, project/capability reads, task requests,
> and OS-mediated cross-tool context packets. **Activity-event and telemetry writes
> are declared in the contract but not implemented** (retired stubs — see
> `TOOL_INTEGRATION_CONTRACT.md` §Current Gateway Boundary). Every gateway call is
> capability- and scope-checked server-side — declaring a capability in the
> manifest does not bypass those checks, and does not make an unimplemented
> endpoint work.

*Why:* "the read, write, and context layers have all landed" is the single most
misleading clause in the docs, and it sits in the question that chooses the build
track.

---

## Edit 3 — `README.md:110-113` (§4 Track B step 4)

Keep the list, annotate the two dead entries:

> - `POST /api/tool-gateway/task-requests` — create a task request (capability `tasks`).
> - `POST /api/tool-gateway/activity-events` — **not implemented** (retired stub; 503 on Postgres). Declare `emittedEvents` for the future; nothing will be delivered.
> - `POST /api/tool-gateway/telemetry-events` — **not implemented** (retired stub; 503 on Postgres). This is why current external tools opt out of telemetry.
> - `POST /api/tool-gateway/context-requests` — request an OS-mediated packet, subject to `contextDependencies`/`contextExposures` and sensitivity.

---

## Edit 4 — `TOOL_INTEGRATION_CONTRACT.md` §Read Endpoints (two endpoints are missing)

Neither is documented anywhere in `docs/tool-building/`, so tools cannot discover
them. `trade-partners` is significant: it makes the OS the system of record for
project trade partners, and a tool that does not know it exists will duplicate
that data locally.

Add:

> `POST /api/tool-gateway/refresh-session`
>
> Requires a Bearer token. Returns a new token and expiry. Gateway tokens last 15
> minutes (`defaultSessionTtlMs`, `toolGatewayToken.ts`); refresh at ~12 minutes.
> If refresh fails because the token already expired, send the user back to the OS
> to re-launch.
>
> `GET /api/tool-gateway/trade-partners`
>
> Requires a Bearer token. Returns the token-bound project's active trade partners
> with their disciplines, relationship, project role, contacts, and MSA / prequal /
> do-not-use flags. The OS is the system of record for project trade partners —
> tools should read them here rather than keeping their own partner list.
>
> ```json
> { "projectId": 1, "tradePartners": [ { "id": 12, "name": "…", "disciplines": [ … ] } ] }
> ```

---

## Edit 5 — `TOOL_INTEGRATION_CONTRACT.md:312-320` (packet list)

**Current** — a flat list of seven, only `qaqc_project_summary` annotated.

**Proposed** — mark what each actually returns, and add the warning:

> - `project_task_summary`, target `tasks` — returns data.
> - `project_activity_summary`, target `activity-events` — returns data.
> - `daily_log_candidate_summary`, target `activity-events` — returns data.
> - `daily_log_report_summary`, target `daily-log` — returns data.
> - `constraint_project_summary`, target `constraints` — returns data.
> - `qaqc_project_summary`, target `qaqc` — **always unavailable**: empty items, zero counts, a warning.
> - `weekly_scheduling_constraint_summary`, target `weekly-scheduling-meeting` — **always unavailable**, same shape.
>
> This list is authoritative and is enforced by `supportedPacketTypes`
> (`toolGatewayContextService.ts`). **Declaring a packet type in
> `contextDependencies` does not create it.** A manifest may declare a dependency
> on a packet type the gateway does not support; the request will fail validation
> at runtime. `procurement-manager` currently declares `project_schedule_summary`,
> which is not supported — that dependency is aspirational, not functional.

---

## Edit 6 — add a "verify against the code" block to `README.md` §11

The docs drifted from the implementation with nothing to catch it. Add:

> **These docs describe intent; the code is the source of truth.** Before planning
> work against any gateway endpoint, confirm it is implemented:
>
> - `backend/src/api/toolGatewayRoutes.ts` — the route table and its runtime guards.
> - `backend/src/core/toolGateway/toolGatewayWriteService.ts` — which writes are real and which throw.
> - `backend/src/core/toolGateway/toolGatewayContextService.ts` — `supportedPacketTypes`.
> - `backend/src/core/moduleRegistry/moduleManifest.ts` — manifest validation.
>
> A route existing does not mean it is implemented: `activity-events` and
> `telemetry-events` are mounted, documented, and throw.

---

## Optional — a stale-doc guard

`toolSlugReferenceDoc.test.ts` already fails CI when `TOOL_SLUG_REFERENCE.md`
disagrees with the registry. The same trick would prevent this class of drift: a
test asserting that every endpoint the contract lists under "supported" is not a
throwing stub, and that the documented packet list matches `supportedPacketTypes`.
That is what would have caught this, rather than a careful reader.
