import { createHmac, timingSafeEqual } from "node:crypto";

// Inbound half of the OS-mediated context proxy. The OS calls this tool on
// another tool's behalf, having already decided that tool may read our data —
// see docs/tool-building/EXTERNAL_TOOL_CONTEXT_ENDPOINT.md in the OS repo.
//
// This file answers one question only: did this call come from the OS, recently?
// It makes no permission decision, because the OS already made it.

export const CALLBACK_SIGNATURE_HEADER = "x-os-callback-signature";
const SECRET_ENV = "SCHEDULE_MANAGER_CONTEXT_SECRET";

// Mirrors this tool's manifest contextExposures.allowedRequestingTools — see
// docs/PROCUREMENT_CROSS_TOOL_HANDOFF.md ("What the manifests already say").
// The OS authorizes the requesting tool on its side; this is the tool-side half
// of the same decision, so anyone holding the shared secret still cannot pull a
// project's schedule packet while naming a tool we never agreed to expose to.
const ALLOWED_REQUESTING_TOOLS = new Set(["procurement-manager"]);

// A signed body replays for the whole OS-chosen validity. Bounding how old
// issuedAt may be shrinks that window to something an operator can reason about.
// 60s absorbs clock skew between hosts.
// ponytail: freshness window, not a nonce cache — bounds replay rather than
// eliminating it. Add a nonce store (a table keyed on signature, swept on write)
// if the OS ever issues long-lived packets or replay shows up in practice.
const MAX_ISSUED_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

// The packet builder loads the project's activities before slicing to `limit`,
// so an unbounded value is a free amplification lever for anyone with the secret.
export const MAX_CONTEXT_LIMIT = 200;

// One client-visible message for every rejection reason. Distinct messages
// (missing vs invalid vs expired vs stale vs not-allowed) tell a caller holding a
// captured body which part to change. The specific `reason` rides alongside for
// the server log only — the route must never put it in the response.
const REJECTED = "Callback rejected.";

function reject(reason: string): CallbackVerification {
  return { message: REJECTED, ok: false, reason, status: 401 };
}

export type ContextCallbackPayload = {
  toolLevel: "admin" | "user" | "viewer";
  expiresAt: string;
  issuedAt: string;
  limit: number;
  packetType: string;
  personId: number;
  projectId: number;
  requestingTool: string;
};

export type CallbackVerification =
  | { ok: true; payload: ContextCallbackPayload }
  | { ok: false; status: 401 | 500; message: string; reason: string };

/**
 * Verifies the OS's HMAC over the RAW request body.
 *
 * The body must be the exact bytes received. The OS signs its serialization, so
 * verifying a re-serialized parse (JSON.stringify of the parsed object) will not
 * match whenever key order or number formatting differs.
 */
export function verifyContextCallback(
  rawBody: string,
  signature: string | null,
  now: Date = new Date()
): CallbackVerification {
  const secret = process.env[SECRET_ENV]?.trim();
  if (!secret) {
    // A misconfiguration, not a bad caller. Fails closed either way — the OS
    // turns any non-2xx into a 503 — but the tool's own logs should say which.
    return { message: `${SECRET_ENV} is not set`, ok: false, reason: "secret-unset", status: 500 };
  }

  if (!signature) {
    return reject("missing-signature");
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64url");
  if (!timingSafeEqualString(signature, expected)) {
    return reject("bad-signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return reject("unparseable-body");
  }

  const payload = readPayload(parsed);
  if (!payload) {
    return reject("malformed-body");
  }

  // expiresAt is inside the signed body, so a replay cannot extend it without
  // breaking the signature above.
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    return reject("expired");
  }

  // Written as "must be inside the window" so an unparseable issuedAt (NaN) fails
  // closed rather than sliding past a pair of negated comparisons.
  const issuedAge = now.getTime() - new Date(payload.issuedAt).getTime();
  if (!(issuedAge > -MAX_CLOCK_SKEW_MS && issuedAge < MAX_ISSUED_AGE_MS)) {
    return reject("stale-or-future-issuedAt");
  }

  if (!ALLOWED_REQUESTING_TOOLS.has(payload.requestingTool)) {
    return reject("requesting-tool-not-allowed");
  }

  // Clamped rather than rejected: an over-large limit is the OS asking for "as
  // much as you'll give", not an attack signature worth failing the call over.
  return { ok: true, payload: { ...payload, limit: Math.min(payload.limit, MAX_CONTEXT_LIMIT) } };
}

function readPayload(value: unknown): ContextCallbackPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;

  if (typeof body.packetType !== "string" || !body.packetType) return null;
  if (typeof body.requestingTool !== "string" || !body.requestingTool) return null;
  if (!Number.isInteger(body.projectId) || (body.projectId as number) <= 0) return null;
  if (!Number.isInteger(body.personId)) return null;
  if (!Number.isInteger(body.limit) || (body.limit as number) <= 0) return null;
  if (typeof body.expiresAt !== "string" || Number.isNaN(new Date(body.expiresAt).getTime())) return null;
  if (typeof body.issuedAt !== "string") return null;

  return {
    toolLevel:
      body.toolLevel === "admin" || body.toolLevel === "user" || body.toolLevel === "viewer"
        ? body.toolLevel
        : "viewer",
    expiresAt: body.expiresAt,
    issuedAt: body.issuedAt,
    limit: body.limit as number,
    packetType: body.packetType,
    personId: body.personId as number,
    projectId: body.projectId as number,
    requestingTool: body.requestingTool,
  };
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
