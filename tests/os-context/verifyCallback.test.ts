import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyContextCallback } from "@/lib/os-context/verifyCallback";

const SECRET = "context-secret-abc";
const NOW = new Date("2026-07-28T14:00:30.000Z");

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    toolLevel: "user",
    expiresAt: "2026-07-28T14:01:00.000Z",
    issuedAt: "2026-07-28T14:00:00.000Z",
    limit: 10,
    packetType: "project_schedule_summary",
    personId: 7,
    projectId: 42,
    requestingTool: "procurement-manager",
    ...overrides,
  });
}

function sign(raw: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(raw).digest("base64url");
}

beforeEach(() => {
  process.env.SCHEDULE_MANAGER_CONTEXT_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SCHEDULE_MANAGER_CONTEXT_SECRET;
});

describe("verifyContextCallback", () => {
  it("accepts a correctly signed, unexpired callback", () => {
    const raw = body();
    const result = verifyContextCallback(raw, sign(raw), NOW);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.payload.projectId).toBe(42);
    expect(result.ok === true && result.payload.requestingTool).toBe("procurement-manager");
  });

  it("defaults toolLevel to viewer, never admin, when an older OS build omits it", () => {
    const raw = body({ toolLevel: undefined });
    const result = verifyContextCallback(raw, sign(raw), NOW);

    expect(result.ok === true && result.payload.toolLevel).toBe("viewer");
  });

  it("rejects a signature made with a different secret", () => {
    const raw = body();
    const result = verifyContextCallback(raw, sign(raw, "wrong-secret"), NOW);

    expect(result.ok === false && result.status).toBe(401);
  });

  it("rejects a body mutated after signing", () => {
    // The attack the signature exists to stop: same signature, different project.
    const signature = sign(body());
    const result = verifyContextCallback(body({ projectId: 99 }), signature, NOW);

    expect(result.ok === false && result.status).toBe(401);
  });

  it("rejects a missing signature", () => {
    expect(verifyContextCallback(body(), null, NOW).ok).toBe(false);
  });

  it("rejects an expired callback even when correctly signed", () => {
    const raw = body();
    const late = new Date("2026-07-28T14:02:00.000Z");

    const result = verifyContextCallback(raw, sign(raw), late);

    expect(result.ok === false && result.status).toBe(401);
  });

  it("rejects a malformed body", () => {
    const raw = "not json";
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(false);
  });

  it("rejects a body missing required scope fields", () => {
    const raw = JSON.stringify({ packetType: "project_schedule_summary" });
    const result = verifyContextCallback(raw, sign(raw), NOW);

    expect(result.ok === false && result.status).toBe(401);
  });

  it("reports a missing secret as a misconfiguration, not a bad caller", () => {
    delete process.env.SCHEDULE_MANAGER_CONTEXT_SECRET;
    const raw = body();

    const result = verifyContextCallback(raw, sign(raw), NOW);

    expect(result.ok === false && result.status).toBe(500);
  });
});
