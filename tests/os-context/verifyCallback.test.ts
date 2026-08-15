import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyContextCallback, MAX_CONTEXT_LIMIT } from "@/lib/os-context/verifyCallback";

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

// SECURITY_REMEDIATION_HANDOFF #4 — a valid HMAC alone is not enough: the call
// must also be fresh, from an allowed tool, and bounded in what it can ask for.
describe("verifyContextCallback — replay, allowlist and limit bounds (#4)", () => {
  it("rejects a captured body replayed after the freshness window", () => {
    // Signature genuine, and the OS's own expiresAt has NOT passed — only the
    // issuedAt window stops this, which is the whole point of the finding.
    const raw = body({ issuedAt: "2026-07-28T13:50:00.000Z", expiresAt: "2026-07-28T15:00:00.000Z" });
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(false);
  });

  it("accepts a callback issued within the window", () => {
    const raw = body({ issuedAt: "2026-07-28T14:00:00.000Z", expiresAt: "2026-07-28T14:05:00.000Z" });
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(true);
  });

  it("rejects a future-dated issuedAt beyond clock skew", () => {
    const raw = body({ issuedAt: "2026-07-28T14:10:00.000Z", expiresAt: "2026-07-28T14:15:00.000Z" });
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(false);
  });

  it("rejects an unparseable issuedAt rather than letting NaN slip through", () => {
    const raw = body({ issuedAt: "not-a-date" });
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(false);
  });

  it("rejects a correctly-signed callback naming a tool the manifest does not allow", () => {
    for (const tool of ["weekly-report-builder", "safetalk", "schedule-manager"]) {
      const raw = body({ requestingTool: tool });
      expect(verifyContextCallback(raw, sign(raw), NOW).ok, `${tool} must not be allowed`).toBe(false);
    }
  });

  it("accepts the one tool the manifest does allow", () => {
    const raw = body({ requestingTool: "procurement-manager" });
    expect(verifyContextCallback(raw, sign(raw), NOW).ok).toBe(true);
  });

  it("clamps an oversized limit instead of loading the project unbounded", () => {
    const raw = body({ limit: 1_000_000 });
    const res = verifyContextCallback(raw, sign(raw), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.limit).toBe(MAX_CONTEXT_LIMIT);
  });

  it("leaves a reasonable limit alone", () => {
    const raw = body({ limit: 10 });
    const res = verifyContextCallback(raw, sign(raw), NOW);
    if (res.ok) expect(res.payload.limit).toBe(10);
  });

  it("gives every rejection the same client-visible message", () => {
    const cases = [
      body({ requestingTool: "safetalk" }),
      body({ issuedAt: "2026-07-28T13:50:00.000Z", expiresAt: "2026-07-28T15:00:00.000Z" }),
      body({ expiresAt: "2026-07-28T14:00:00.000Z" }),
      body({ personId: "not-an-int" }),
    ];
    const messages = new Set(
      cases.map((raw) => {
        const res = verifyContextCallback(raw, sign(raw), NOW);
        return res.ok ? "accepted" : res.message;
      }),
    );
    expect(messages.size, "distinct messages leak which check failed").toBe(1);
    expect(messages.has("accepted")).toBe(false);
  });
});
