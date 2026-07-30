import { describe, it, expect } from "vitest";

describe("health route", () => {
  it("answers 200 with ok so the OS health check passes", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
