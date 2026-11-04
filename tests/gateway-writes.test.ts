import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { handleGatewayWrite, type WriteDeps } from "@/lib/gateway/writes";
import { scheduleDraftWriteContract as contract, scheduleDraftWriteContractHash as contractHash } from "@/lib/gateway/writeContract";
import { scheduleUpdateStateContract as readContract, scheduleUpdateStateContractHash as readHash } from "@/lib/gateway/contract";
import { parseDay } from "@/lib/gateway/updateState";
import type { DraftWriteInput, DraftWriteResult, Writer } from "@/lib/gateway/draftWrite";
import { middleware } from "@/middleware";
import { POST } from "@/app/api/gateway/writes/route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const NOW = 1_800_000_000_000;
const entry = { key: "1.1|set ahu-1", status: "in_progress", percentComplete: 60, actualStart: "2026-10-28", actualFinish: null, expectedDraft: null };
const args = { projectId: 41, idempotencyKey: "key-0001-abcd", asOfDate: "2026-11-07", expectedDraftAsOfDate: "2026-11-03", entries: [entry] };
function delegation(patch: Record<string, unknown> = {}) {
  return {
    protocol: "connect.tool.write/1", audience: "tool.schedule-manager", companyId: "skiles-group",
    actionId: contract.id, version: contract.version, contractHash, requestId: "req-1",
    issuedAt: NOW - 1000, expiresAt: NOW + 9000, projectId: 41, personId: 7,
    agentId: "480397a0-2449-432a-abcf-29abe1d90a56", clientKey: "claude",
    authorizationGeneration: "1", consentBinding: "binding", arguments: args,
    ...patch,
  };
}
const signed = (body: unknown, key = privateKey) => {
  const raw = JSON.stringify(body);
  return { raw, signature: sign(null, Buffer.from(raw), key).toString("base64url") };
};
const saved: DraftWriteResult = { saved: true, asOfDate: "2026-11-07", activities: ["1.1|set ahu-1"], reason: null, message: null };
function deps(current = true, result: DraftWriteResult = saved) {
  const introspected: string[] = [], saves: [number, DraftWriteInput, Writer][] = [], afterSaves: unknown[] = [];
  const d: WriteDeps = {
    publicKey, connectOrigin: "https://connect.example", now: () => NOW,
    save: async (projectId, input, who) => { saves.push([projectId, input, who]); return result; },
    afterSave: (a) => { afterSaves.push(a); },
    fetch: (async (url: string, init: RequestInit) => { introspected.push(`${url} ${new Headers(init.headers).get("X-Connect-Read-Signature")}`); return Response.json({ current }); }) as unknown as typeof fetch,
  };
  return { d, introspected, saves, afterSaves };
}
const call = async (body: unknown, d: WriteDeps) => { const { raw, signature } = signed(body); return handleGatewayWrite(raw, signature, d); };

describe("gateway draft write", () => {
  it("introspects, then saves for the delegated person and agent, and answers in the result envelope", async () => {
    const { d, introspected, saves } = deps();
    const res = await call(delegation(), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: "connect.tool.result/2", requestId: "req-1", actionId: contract.id, contractHash, companyId: "skiles-group", projectId: 41, dataMode: "live", data: saved });
    expect(introspected).toHaveLength(1);
    expect(introspected[0]).toMatch(/^https:\/\/connect\.example\/internal\/ai-tool-reads\/introspect /);
    expect(saves).toEqual([[41, args, { personId: 7, agentId: "480397a0-2449-432a-abcf-29abe1d90a56", clientKey: "claude" }]]);
  });

  it("hands a saved write to afterSave with Connect's requestId, and a refused one to nobody", async () => {
    const ok = deps();
    await call(delegation(), ok.d);
    expect(ok.afterSaves).toEqual([{ osProjectId: 41, requestId: "req-1", who: { personId: 7, agentId: "480397a0-2449-432a-abcf-29abe1d90a56", clientKey: "claude" }, idempotencyKey: "key-0001-abcd", data: saved }]);
    const refused = deps(true, { saved: false, asOfDate: null, activities: [], reason: "stale", message: "x" });
    expect((await call(delegation(), refused.d)).status).toBe(200);
    expect(refused.afterSaves).toEqual([]);
  });

  it("saves nothing when Connect says the write is no longer current", async () => {
    const { d, saves } = deps(false);
    expect((await call(delegation(), d)).status).toBe(503);
    expect(saves).toEqual([]);
  });

  it("refuses a bad signature, a read delegation, another contract and malformed arguments without saving", async () => {
    const { d, saves } = deps();
    const { raw } = signed(delegation());
    const other = generateKeyPairSync("ed25519").privateKey;
    expect((await handleGatewayWrite(raw, signed(delegation(), other).signature, d)).status).toBe(503);
    expect((await handleGatewayWrite(raw, null, d)).status).toBe(503);
    for (const patch of [
      { protocol: "connect.tool.read/2" },
      { actionId: readContract.id, version: readContract.version, contractHash: readHash },
      { contractHash: "0".repeat(64) },
      { arguments: { ...args, projectId: 42 } },
      { arguments: { ...args, note: "call Bob" } },
      { arguments: { ...args, idempotencyKey: "short" } },
      { arguments: { ...args, entries: Array(16).fill(entry) } },
      { arguments: { ...args, entries: [{ ...entry, status: "done" }] } },
      { arguments: { ...args, entries: [{ ...entry, percentComplete: 101 }] } },
      { arguments: { ...args, entries: [{ ...entry, note: "x" }] } },
      { arguments: { ...args, entries: [{ ...entry, expectedDraft: { status: "in_progress" } }] } },
      { arguments: { ...args, expectedDraftAsOfDate: undefined } },
      { personId: 0 },
      { expiresAt: NOW - 1 },
    ]) expect((await call(delegation(patch), d)).status, JSON.stringify(patch)).toBe(503);
    expect(saves).toEqual([]);
  });

  it("parseDay answers null for impossible dates instead of throwing", () => {
    expect(["2026-13-40", "2026-02-30", "2026-1-01"].map(parseDay)).toEqual([null, null, null]);
    expect(parseDay("2026-11-07")?.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("is public to the middleware (no session) and off by default", async () => {
    const req = new NextRequest(new URL("http://localhost/api/gateway/writes"), { method: "POST" });
    expect((await middleware(req)).headers.get("x-middleware-next")).toBe("1");
    const { raw, signature } = signed(delegation());
    const res = await POST(new Request("http://localhost/api/gateway/writes", { method: "POST", body: raw, headers: { "X-Connect-Read-Signature": signature } }));
    expect(res.status).toBe(503);
  });

  it("keeps Connect's pinned contract; byte-identical to Connect's copy when CONNECT_SOURCE_ROOT is set", async () => {
    expect(contractHash).toBe("7f9fac3c31e7c11def5f46e07e6986d2dea6f464a30dca980e620d9f588df5cd");
    const root = process.env.CONNECT_SOURCE_ROOT;
    if (!root) return;
    const connect = await readFile(resolve(root, "backend/src/core/aiTools/scheduleManagerWriteContract.ts"));
    expect(connect.equals(await readFile(resolve(import.meta.dirname, "../lib/gateway/writeContract.ts")))).toBe(true);
  });
});
