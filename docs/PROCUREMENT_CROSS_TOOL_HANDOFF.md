# Handoff: cross-tool context between Procurement and Schedule Manager

For the Procurement Management team. Written 2026-07-29 from the schedule-manager
side, checked against the OS backend and the procurement repo on that date rather
than against any tool's docs.

## State of play

Cross-tool context runs through the OS. Neither tool calls the other directly —
Skiles Connect authorizes the request, then calls the owning tool server-to-server
and hands the answer back.

There are two independent directions, and they are at different stages:

| Direction | Packet | Server side | Client side |
|---|---|---|---|
| Procurement reads the schedule | `project_schedule_summary` | **Built** (schedule-manager) | **Not built** (procurement) |
| Schedule Manager reads procurement | `procurement_project_summary` | **Not built** (procurement) | **Not built** (schedule-manager) |

Both manifests already declare both directions in the OS registry
(`backend/src/core/moduleRegistry/moduleRegistry.ts`), so no OS change is needed
for either. What is missing is application code in Procurement, plus a client in
Schedule Manager for the second direction.

### The old blocker is gone — ignore any note that says otherwise

`docs/os-doc-corrections.md` in this repo (written 2026-07-28) says
`project_schedule_summary` "is not a supported packet type" and that procurement's
dependency is "aspirational, not functional." **That is no longer true.** The OS
replaced the hardcoded `supportedPacketTypes` tuple with owners derived from each
manifest's `contextExposures` (`toolGatewayContextService.ts`,
`getContextPacketOwners()`), and the schedule-manager manifest now carries the
exposure. The registry comment records the change:

> Closes BUILD_INTAKE.md Q7, which deferred this declaration because the packet
> type could never be accepted while supportedPacketTypes was a hardcoded tuple.
> Packet types are derived from these declarations now.

If you planned around that blocker, re-plan. Nothing in the OS is stopping this.

### What the manifests already say

Schedule Manager exposes:

```ts
contextExposures: [{
  packetType: "project_schedule_summary",
  allowedRequestingTools: ["procurement-manager"],   // only you
  sensitivity: "project_team",
}]
```

Procurement exposes:

```ts
contextExposures: [{
  packetType: "procurement_project_summary",
  allowedRequestingTools: ["weekly-report-builder", "schedule-upcoming",
                           "priority-engine", "schedule-manager"],
  sensitivity: "project_team",
}]
```

and declares the matching dependency on us (`required: false`), as we do on you.
`sensitivity: project_team` means the requesting person's OS access role must
meet that bar; the OS enforces it before either tool is called.

---

## Direction A — Procurement reads the schedule

This is the one you can build today. Our side is live.

### The request

```
POST {SKILES_OS_API_BASE_URL}/tool-gateway/context-requests
Authorization: Bearer <your gateway token>

{ "target": "schedule-manager",
  "packetType": "project_schedule_summary",
  "limit": 25 }
```

The OS derives project and person from the token — never send them. It validates
your manifest declares the dependency, that we expose the packet to you, and that
the person's access role clears `project_team`, then calls us and returns our
payload.

### The response

```jsonc
{
  "packetType": "project_schedule_summary",
  "projectId": 9,                    // the OS project id, not ours
  "items": [
    {
      "osPartnerId": 77,             // join key — the OS trade partner id
      "partnerName": "Amber Electrical Contractors, Inc.",
      "projectId": 9,
      "activityCount": 34,
      "firstActivityStart": "2026-08-11T00:00:00.000Z",
      "lastActivityFinish": "2026-11-02T00:00:00.000Z",
      "minFloatDays": 3.5,
      "isCritical": true
    }
  ],
  "summary": {
    "activityCount": 252,
    "dataDate": "2026-07-20T00:00:00.000Z",
    "importedAt": "2026-07-27T14:02:00.000Z",
    "projectFinish": "2027-01-15T00:00:00.000Z",
    "scheduledTradeCount": 15
  },
  "warnings": []
}
```

### What the grain means, and why

**One row per trade partner, not per activity.** A CPM schedule holds thousands of
activities and the OS caps a packet at 25 items; a project runs 10–15 trade
partners, so this grain covers the whole schedule inside the cap. You keep your own
item detail — what you need from us is an anchor date per trade to check your
required-on-site dates against.

Field by field:

- **`osPartnerId`** — join on this, not on `partnerName`. Both tools get partners
  from the same OS roster, so the id is stable; the name is a display snapshot.
- **`firstActivityStart`** — the earliest planned start across that partner's
  scheduled work. This is the date your required-on-site should precede. `null`
  when none of their activities carry dates.
- **`lastActivityFinish`** — latest planned finish for that partner.
- **`minFloatDays`** — smallest total float across their activities, in days,
  rounded to one decimal. Negative means behind. `null` when float is absent.
- **`isCritical`** — true when *any* of that partner's activities is on the
  critical path. Deliberately a flag, not a count: a trade with one critical
  activity is a trade whose material date matters.
- **`activityCount`** — how many scheduled activities map to that partner.

Items are sorted **soonest `firstActivityStart` first** — the trade whose material
is needed next is the one you most need to see. Partners with no dated activity
sort last.

### Read the warnings — they change what the numbers mean

`warnings` is not decoration. Our packet is built from a dictionary that maps
schedule activity names to scopes to trades, and that mapping is incomplete on a
fresh project. Expect:

- `"N activity names are not mapped to a scope and are not counted."` — real
  scheduled work is missing from `items`. A trade may look lighter than it is.
- `"N activities map to a trade with no partner assigned on this project."` — the
  work is known but nobody is assigned, so it produces no row at all.
- `"N trades have scheduled work; the N starting soonest are included."` — you hit
  the limit; the tail is truncated by start date.

Two whole-packet cases return `items: []` with a single warning and are normal, not
errors: no schedule-manager project is linked to the Connect project yet, or no
schedule has been imported yet.

### One wrinkle to code defensively around

The empty-packet path emits `summary.tradeCount` while the populated path emits
`summary.scheduledTradeCount`. That inconsistency is on our side and we intend to
fix it to `scheduledTradeCount` everywhere. Until then, do not rely on either key
being present; `items.length` is authoritative. Tell us when you start consuming
and we will land the fix ahead of you.

---

## Direction B — Schedule Manager reads procurement

This is the half **you** need to build for us: the callback endpoint the OS calls
on our behalf. Your manifest already points at it:

```
contextEndpoint: https://sgconnect.dev/procurement-manager/api/os-context
```

That route does not exist yet in the procurement repo. You already have `/launch`,
`/api/health` and `/api/os/follow-up-task`, so the OS-facing patterns are familiar
— this adds one more.

### The contract

The OS POSTs a JSON body to your `contextEndpoint` with an HMAC signature header:

```
POST /procurement-manager/api/os-context
x-os-callback-signature: <base64url HMAC-SHA256 of the RAW body>

{ "packetType": "procurement_project_summary",
  "requestingTool": "schedule-manager",
  "projectId": 9,
  "personId": 4,
  "toolLevel": "user",
  "limit": 25,
  "issuedAt": "2026-07-29T12:00:00.000Z",
  "expiresAt": "2026-07-29T12:05:00.000Z" }
```

Respond with the same envelope shape we use: `{ packetType, projectId, items,
summary, warnings }`.

Our implementation is a working reference — copy the shape, not the contents:

- `lib/os-context/verifyCallback.ts` — signature verification
- `app/api/os-context/route.ts` — the route
- `lib/os-context/scheduleContextPacket.ts` — building the packet

### Five things that cost us time — take them for free

1. **Sign over the raw bytes.** Verify the HMAC against the exact body received,
   before any parse. Verifying a re-serialized `JSON.stringify(parsed)` fails
   whenever key order or number formatting differs, and the failure looks like a
   wrong secret.

2. **Exempt the route from auth middleware.** It carries an HMAC, not a session
   cookie. If your middleware redirects it to `/login`, every call fails and the
   OS reports your tool unreachable — with nothing in your logs saying why. Add it
   to the equivalent of our `PUBLIC_PATHS`.

3. **Name the secret after your slug.** The OS derives the env var name from the
   registry slug, so it is not free to differ: yours is
   `PROCUREMENT_MANAGER_CONTEXT_SECRET`, set to the same value on your service and
   on the OS. Ours is `SCHEDULE_MANAGER_CONTEXT_SECRET`. It is not in your
   `.env.example` yet.

4. **Fail closed, but distinguish the reasons.** Missing/invalid signature,
   malformed body, or an `expiresAt` in the past → `401`. A missing secret is a
   misconfiguration → `500`. The OS turns any non-2xx into a 503 for the caller,
   so your own logs are the only place the difference survives.

5. **Trust the OS's authorization, and re-check the scope.** The OS has already
   decided that the requesting tool, person, project and sensitivity are allowed —
   do not re-litigate it. But do scope every query by the `projectId` in the signed
   body: that is the tool-side obligation, and it is what stops a bug in one
   project leaking another's data.

`expiresAt` sits inside the signed body, so a replay cannot extend it without
breaking the signature. Check it anyway — we do.

---

## Checklist

**Procurement, direction A (consume ours):**
- [ ] Client for `POST /tool-gateway/context-requests`
- [ ] Handle `items: []` plus a warning as a normal answer, not an error
- [ ] Surface `warnings` where a user can see them — they explain missing trades
- [ ] Join on `osPartnerId`, display `partnerName`
- [ ] Compare your required-on-site against `firstActivityStart`

**Procurement, direction B (serve ours):**
- [ ] `POST /api/os-context` route at the manifest's `contextEndpoint`
- [ ] HMAC verification over the raw body, with expiry check
- [ ] Route exempted from auth middleware
- [ ] `PROCUREMENT_MANAGER_CONTEXT_SECRET` set on the service and in the OS, and
      added to `.env.example`
- [ ] `procurement_project_summary` builder, scoped by the signed `projectId`
- [ ] Reject any `packetType` other than the one you expose

**Schedule Manager (us):**
- [ ] Client for `procurement_project_summary` — ours to build, after you serve it
- [ ] Fix the `tradeCount` / `scheduledTradeCount` inconsistency

## Do not plan against these

`POST /tool-gateway/activity-events` and `POST /tool-gateway/telemetry-events` are
mounted and documented but are retired stubs that throw, returning 503 on the
Postgres runtime. Both our manifests declare a telemetry opt-out for exactly this
reason. Declare `emittedEvents` so the contract is ready; do not build emission
against them.

## Suggested sequence

Direction A first — our side is live, so you can build and test against real data
immediately, and it is the direction with the clearer payoff (material dates
checked against real schedule dates). Direction B needs your packet builder
designed before either of us writes integration code.

Questions on the packet shape, the grain, or anything above: ask the
schedule-manager side. If you want a field that isn't there, say so before you
work around its absence — adding one to the packet is cheap, and a workaround
built on `partnerName` string matching will not survive a partner rename.
