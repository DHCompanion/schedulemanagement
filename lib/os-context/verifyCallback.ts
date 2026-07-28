import { createHmac, timingSafeEqual } from "node:crypto";

// Inbound half of the OS-mediated context proxy. The OS calls this tool on
// another tool's behalf, having already decided that tool may read our data —
// see docs/tool-building/EXTERNAL_TOOL_CONTEXT_ENDPOINT.md in the OS repo.
//
// This file answers one question only: did this call come from the OS, recently?
// It makes no permission decision, because the OS already made it.

export const CALLBACK_SIGNATURE_HEADER = "x-os-callback-signature";
const SECRET_ENV = "SCHEDULE_MANAGER_CONTEXT_SECRET";

export type ContextCallbackPayload = {
  accessRole: string;
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
  | { ok: false; status: 401 | 500; message: string };

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
    return { message: `${SECRET_ENV} is not set`, ok: false, status: 500 };
  }

  if (!signature) {
    return { message: "Missing callback signature.", ok: false, status: 401 };
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64url");
  if (!timingSafeEqualString(signature, expected)) {
    return { message: "Invalid callback signature.", ok: false, status: 401 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { message: "Malformed callback body.", ok: false, status: 401 };
  }

  const payload = readPayload(parsed);
  if (!payload) {
    return { message: "Malformed callback body.", ok: false, status: 401 };
  }

  // expiresAt is inside the signed body, so a replay cannot extend it without
  // breaking the signature above.
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    return { message: "Callback has expired.", ok: false, status: 401 };
  }

  return { ok: true, payload };
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
    accessRole: typeof body.accessRole === "string" ? body.accessRole : "",
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
