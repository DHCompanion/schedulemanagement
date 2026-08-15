# Security Remediation Handoff — Schedule Manager (CPM)

*Generated 2026-08-14 from an ecosystem-wide security review of Skiles Group Connect
and its external tools. Findings come from a direct read of this repo. Line numbers
are from that snapshot — verify they still point at the right code before acting.*

## How to use this prompt

Paste everything below into a new session opened in this repo
(`/home/coder/projects/Skilesconnect/schedulemanagement`).

> You are a security engineer fixing confirmed findings in Schedule Manager, an external
> tool that connects to Skiles Group Connect (the "OS") through the Tool Gateway. Work the
> findings in severity order. For each: **reproduce and confirm first** — do not trust this
> list blindly. Then fix the root cause and leave one runnable regression check behind.
> Don't refactor unrelated code. The launch handshake and the os-context HMAC verification
> are sound — keep that trust model. These findings are about the tool's own session and
> standalone-login handling.

## How this tool fits the ecosystem

- Users arrive via `GET /launch?token=…`; the token is validated by exchanging it at the OS
  (`GET {SKILES_OS_API_BASE_URL}/tool-gateway/project-context`) — `lib/os-gateway.ts:22-43`.
  Not verified locally, by design.
- Session is a self-contained signed cookie `sms_scope` (`lib/scope.ts`); there is also a
  standalone shared-password login (`lib/auth.ts`, `app/api/login/route.ts`) for
  out-of-OS access. Most findings are in this second path and in key management.

## Findings (most severe first)

### 1. HIGH — Privilege escalation: admin cookie shares the session cookie's value
- **Where:** `lib/auth.ts:23-34` (`isAuthed`/`isAdmin` both compare against `APP_SESSION_TOKEN`),
  set at `app/api/login/route.ts:20-22` (`sms_session` and `sms_admin` both get
  `APP_SESSION_TOKEN`).
- **What:** any standalone user who logged in with `APP_PASSWORD` can copy their `sms_session`
  cookie value into an `sms_admin` cookie and become admin — the two checks are identical.
- **Fix direction:** admin status must be a distinct, unforgeable signal (e.g. a signed claim
  inside the scope token, or a separately-keyed value), not the same shared constant.

### 2. HIGH — `APP_SESSION_TOKEN` is overloaded as signing key *and* cookie value
- **Where:** `lib/scope.ts:38-41` (used as the scope-cookie HMAC signing key) and
  `app/api/login/route.ts:20-22` (used as the literal `sms_session`/`sms_admin` cookie value).
- **What:** leaking the session cookie leaks the key that forges arbitrary scope cookies —
  any `projectId`, any `personId`, `toolLevel:"admin"`. One secret guards two different trust
  levels.
- **Fix direction:** split them — a dedicated signing key that is never emitted to the client,
  separate from any session-cookie value.

### 3. MEDIUM — `viewer` and `user` levels are indistinguishable; both can write
- **Where:** `toolLevel` is consumed only for the admin bit (`lib/auth.ts:40-42`,
  `lib/scope.ts:108-115`); all writes in `app/api/**` gate on project scope, not level.
- **What:** a `viewer`-level OS session can commit imports, finalize progress updates, assign
  trades, and dismiss findings. No read-only enforcement.
- **Fix direction:** enforce the level ladder on mutating routes (this repo is already on
  `feat/rbac-toollevel-gating` — this is the finding that branch should close).

### 4. MEDIUM — os-context: replayable, no `requestingTool` allowlist
- **Where:** `lib/os-context/verifyCallback.ts:112` (`requestingTool` parsed, never checked),
  `:116` (`issuedAt` parsed, never used for a freshness window).
- **What:** a captured body+signature replays for the whole OS-chosen validity; anyone with the
  shared `SCHEDULE_MANAGER_CONTEXT_SECRET` can read any project's schedule packet by `projectId`.
- **Fix direction:** enforce `allowedRequestingTools`; add an `issuedAt` skew window and/or nonce.

### 5. LOW — assorted hardening
- **No rate limiting / lockout on `POST /api/login`;** password compared with non-constant-time
  `===` (`lib/auth.ts:9-20`).
- **`secure` cookie flag conditional on `NODE_ENV === "production"`** (`lib/auth.ts:50`,
  `lib/scope.ts:92`).
- **Public-path matching is prefix-based** (`middleware.ts:18`, `startsWith`) — `/launchX`,
  `/api/healthz`, `/api/os-contextY` would bypass the session check. Use exact matching.
- **`POST /api/imports/preview`** parses arbitrary uploaded XML with no scope check and no size
  limit (`app/api/imports/preview/route.ts`) via `fast-xml-parser` in a serverless function.
- **Launch error path 303-redirects to an unvalidated-token's `returnUrl`** before any token
  check (`app/launch/route.ts:34`) — mitigated by the origin allowlist, but path/query are not
  restricted.
- **os-context returns distinct 401 messages** for missing vs invalid vs expired vs malformed
  (`verifyCallback.ts:78,83,90,101`) — a minor oracle; make them uniform.

## Out of scope / by design — do not "fix"
- Calling the OS to validate the launch token rather than verifying HMAC locally. Correct.
- Absent `refresh-session` support — renewal is re-launch, by design.
