import { describe, it, expect, vi, afterEach } from "vitest";
import { emitUpdateEvent } from "@/lib/spine";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function stub(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return responses.shift()!; }));
  return calls;
}
const event = {
  osProjectId: 9, eventType: "schedule-manager.update.agent_drafted" as const, updateId: "upd-1",
  summary: "Your agent saved 2 activities to the 2026-11-03 draft update", payload: { requestId: "r-1", asOfDate: "2026-11-03", activityCount: 2 },
};

describe("emitUpdateEvent", () => {
  it("mints a service session, then posts the event keyed to the draft", async () => {
    vi.stubEnv("SKILES_OS_API_BASE_URL", "https://api.example/api");
    vi.stubEnv("SCHEDULE_MANAGER_CONTEXT_SECRET", "s".repeat(32));
    const calls = stub(Response.json({ token: "svc" }), Response.json({ id: 1 }, { status: 201 }));
    await emitUpdateEvent(event);
    expect(calls.map((c) => c.url)).toEqual(["https://api.example/api/tool-gateway/service-sessions", "https://api.example/api/tool-gateway/activity-events"]);
    expect(new Headers(calls[1].init.headers).get("Authorization")).toBe("Bearer svc");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      eventType: "schedule-manager.update.agent_drafted", sourceRecordId: "upd-1", idempotencyKey: "agent_drafted:upd-1",
      subjectType: "progress_update", subjectId: "upd-1", summary: event.summary, payload: event.payload,
    });
  });

  it("never throws: a failed mint or post is logged and dropped", async () => {
    vi.stubEnv("SKILES_OS_API_BASE_URL", "https://api.example/api");
    vi.stubEnv("SCHEDULE_MANAGER_CONTEXT_SECRET", "s".repeat(32));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stub(Response.json({ token: "svc" }), new Response("nope", { status: 400 }));
    await expect(emitUpdateEvent(event)).resolves.toBeUndefined();
    stub(new Response("down", { status: 503 }));
    await expect(emitUpdateEvent(event)).resolves.toBeUndefined();
    await expect(emitUpdateEvent({ ...event, osProjectId: null })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });
});
