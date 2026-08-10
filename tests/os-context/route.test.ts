import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { CALLBACK_SIGNATURE_HEADER } from "@/lib/os-context/verifyCallback";
import { SCHEDULE_PACKET_TYPE } from "@/lib/os-context/scheduleContextPacket";

const SECRET = "test-context-secret";

beforeEach(() => {
  process.env.SCHEDULE_MANAGER_CONTEXT_SECRET = SECRET;
});

function signed(payload: Record<string, unknown>, secret = SECRET) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/os-context", {
    method: "POST",
    headers: { [CALLBACK_SIGNATURE_HEADER]: createHmac("sha256", secret).update(body).digest("base64url") },
    body,
  });
}

const valid = (over: Record<string, unknown> = {}) => ({
  packetType: SCHEDULE_PACKET_TYPE,
  requestingTool: "procurement-manager",
  projectId: 999999,
  personId: 4,
  toolLevel: "user",
  limit: 25,
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  ...over,
});

describe("os-context route", () => {
  it("rejects an unsigned request", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(new Request("http://localhost/api/os-context", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    expect((await POST(signed(valid(), "wrong-secret"))).status).toBe(401);
  });

  it("rejects an expired callback", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid({ expiresAt: new Date(Date.now() - 1000).toISOString() })));
    expect(res.status).toBe(401);
  });

  it("rejects a packet type this tool does not expose", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid({ packetType: "procurement_project_summary" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("procurement_project_summary");
  });

  it("reports a misconfigured secret as a server error, not a bad caller", async () => {
    delete process.env.SCHEDULE_MANAGER_CONTEXT_SECRET;
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(new Request("http://localhost/api/os-context", {
      method: "POST", headers: { [CALLBACK_SIGNATURE_HEADER]: "x" }, body: "{}",
    }));
    expect(res.status).toBe(500);
  });

  it.runIf(!!process.env.DATABASE_URL)("returns an empty packet with a warning for an unlinked project", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid()));
    expect(res.status).toBe(200);
    const packet = await res.json();
    expect(packet.packetType).toBe(SCHEDULE_PACKET_TYPE);
    expect(packet.items).toEqual([]);
    expect(packet.warnings.length).toBeGreaterThan(0);
  });
});
