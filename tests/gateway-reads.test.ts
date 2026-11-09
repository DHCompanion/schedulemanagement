import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { connectPublicKeys, handleGatewayRead, type ReadDeps } from "@/lib/gateway/reads";
import { scheduleUpdateStateContract as contract, scheduleUpdateStateContractHash as contractHash } from "@/lib/gateway/contract";
import { DEFAULT_LOOKAHEAD_WEEKS, type UpdateStateInput, type UpdateStateSource } from "@/lib/gateway/updateState";
import type { LookaheadRow } from "@/lib/lookahead/computeLookahead";
import { middleware } from "@/middleware";
import { POST } from "@/app/api/gateway/reads/route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const NOW = 1_800_000_000_000;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function delegation(patch: Record<string, unknown> = {}) {
  return {
    protocol: "connect.tool.read/2", audience: "tool.schedule-manager", companyId: "skiles-group",
    actionId: contract.id, version: contract.version, contractHash, requestId: "req-1",
    issuedAt: NOW - 1000, expiresAt: NOW + 9000, projectId: 41, personId: 7,
    agentId: "480397a0-2449-432a-abcf-29abe1d90a56", clientKey: "claude",
    authorizationGeneration: "1", consentBinding: "binding", arguments: { projectId: 41 },
    ...patch,
  };
}
const signed = (body: unknown, key = privateKey) => {
  const raw = JSON.stringify(body);
  return { raw, signature: sign(null, Buffer.from(raw), key).toString("base64url") };
};
const row = (uid: number, name: string, patch: Partial<LookaheadRow> = {}): LookaheadRow => ({
  externalUid: uid, canonicalActivityKey: `1.${uid}|${name.toLowerCase()}`, wbsCode: `1.${uid}`, name, type: "task",
  plannedStart: D("2026-11-04"), plannedFinish: D("2026-11-06"),
  progress: { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: "call Bob at 555-0100" },
  slippage: "on-track", dueByDataDate: false, ...patch,
});
function source(rows: LookaheadRow[] = [
  row(1, "Set AHU-1", { slippage: "overdue", dueByDataDate: true, progress: { status: "in_progress", actualStart: D("2026-10-28"), actualFinish: null, percentComplete: 40, note: null } }),
  row(2, "Pull wire L2", { dueByDataDate: true, plannedStart: D("2026-11-03") }),
  row(3, "Hang drywall L3"),
]): UpdateStateSource {
  return {
    asOf: D("2026-11-03"), weeks: 1, importedAt: new Date("2026-10-30T14:00:00.000Z"), lastFinalizedAsOf: D("2026-10-27"),
    draft: { asOfDate: D("2026-11-03"), lookaheadWeeks: 1, updatedAt: new Date("2026-11-03T15:00:00.000Z"),
      entries: [{ canonicalActivityKey: "1.1|set ahu-1", status: "in_progress", percentComplete: 60, actualStart: D("2026-10-28"), actualFinish: null }] },
    rows,
    activityByUid: new Map([[1, { isCritical: true, isMilestone: false }]]),
    forecasts: new Map([[1, { expectedStart: D("2026-10-28"), expectedFinish: D("2026-11-10"), driftDays: 2, pushedByUid: null }]]),
  };
}
function deps(src: UpdateStateSource = source(), current: boolean[] = [true, true]) {
  const introspected: { url: string; body: string; signature: string | null }[] = [];
  const loaded: [number, UpdateStateInput][] = [];
  const d: ReadDeps = {
    publicKeys: [publicKey], connectOrigin: "https://connect.example", now: () => NOW,
    load: async (projectId, input) => { loaded.push([projectId, input]); return src; },
    fetch: (async (url: string, init: RequestInit) => {
      introspected.push({ url, body: String(init.body), signature: new Headers(init.headers).get("X-Connect-Read-Signature") });
      return Response.json({ current: current[introspected.length - 1] ?? false });
    }) as unknown as typeof fetch,
  };
  return { d, introspected, loaded };
}
const read = async (body: unknown, d: ReadDeps, key = privateKey) => {
  const { raw, signature } = signed(body, key);
  return handleGatewayRead(raw, signature, d);
};

describe("gateway update-state read", () => {
  it("introspects before and after, and answers with exactly the contract's keys, late work first", async () => {
    const { d, introspected, loaded } = deps();
    const { raw, signature } = signed(delegation({ arguments: { projectId: 41, asOfDate: "2026-11-03", lookaheadWeeks: 1 } }));
    const res = await handleGatewayRead(raw, signature, d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["actionId", "companyId", "contractHash", "data", "dataMode", "projectId", "requestId", "schemaVersion"]);
    expect(body).toMatchObject({ schemaVersion: "connect.tool.result/2", requestId: "req-1", actionId: contract.id, contractHash, companyId: "skiles-group", projectId: 41, dataMode: "live" });
    expect(body.data).toEqual({
      asOfDate: "2026-11-03", lookaheadWeeks: 1, scheduleImportedAt: "2026-10-30T14:00:00.000Z", lastFinalizedAsOf: "2026-10-27",
      draftUpdate: { asOfDate: "2026-11-03", lookaheadWeeks: 1, entryCount: 1, updatedAt: "2026-11-03T15:00:00.000Z" },
      counts: { lookahead: 3, due: 2, late: 1 }, truncated: false,
      activities: [
        { key: "1.1|set ahu-1", name: "Set AHU-1", wbsCode: "1.1", isCritical: true, isMilestone: false, plannedStart: "2026-11-04", plannedFinish: "2026-11-06", expectedStart: "2026-10-28", expectedFinish: "2026-11-10", driftDays: 2, status: "in_progress", percentComplete: 40, slippage: "overdue", dueByDataDate: true, draft: { status: "in_progress", percentComplete: 60, actualStart: "2026-10-28", actualFinish: null } },
        { key: "1.2|pull wire l2", name: "Pull wire L2", wbsCode: "1.2", isCritical: false, isMilestone: false, plannedStart: "2026-11-03", plannedFinish: "2026-11-06", expectedStart: "2026-11-03", expectedFinish: "2026-11-06", driftDays: 0, status: "not_started", percentComplete: null, slippage: "on-track", dueByDataDate: true, draft: null },
        { key: "1.3|hang drywall l3", name: "Hang drywall L3", wbsCode: "1.3", isCritical: false, isMilestone: false, plannedStart: "2026-11-04", plannedFinish: "2026-11-06", expectedStart: "2026-11-04", expectedFinish: "2026-11-06", driftDays: 0, status: "not_started", percentComplete: null, slippage: "on-track", dueByDataDate: false, draft: null },
      ],
    });
    expect(loaded).toEqual([[41, { asOfDate: "2026-11-03", lookaheadWeeks: 1 }]]);
    expect(introspected).toEqual([0, 1].map(() => ({ url: "https://connect.example/internal/ai-tool-reads/introspect", body: raw, signature })));
  });

  it("defaults to a 1-week lookahead and never carries notes or procurement", async () => {
    expect(DEFAULT_LOOKAHEAD_WEEKS).toBe(1);
    const { d, loaded } = deps();
    const text = await (await read(delegation(), d)).text();
    expect(loaded).toEqual([[41, { asOfDate: undefined, lookaheadWeeks: undefined }]]);
    expect(text).not.toMatch(/555-0100|note|procure|partner|vendor/i);
  });

  it("answers a project with nothing linked as an empty schedule", async () => {
    const empty: UpdateStateSource = { ...source([]), importedAt: null, lastFinalizedAsOf: null, draft: null, forecasts: new Map(), activityByUid: new Map() };
    const data = (await (await read(delegation(), deps(empty).d)).json()).data;
    expect(data).toEqual({ asOfDate: "2026-11-03", lookaheadWeeks: 1, scheduleImportedAt: null, lastFinalizedAsOf: null, draftUpdate: null, counts: { lookahead: 0, due: 0, late: 0 }, activities: [], truncated: false });
  });

  it("drops whole activities from the end and sets truncated to stay under the byte cap", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(100 + i, `Install rooftop air handling unit and curb, level ${i}`, { slippage: i < 5 ? "overdue" : "on-track" }));
    const res = await read(delegation(), deps(source(many)).d);
    const text = await res.text(), data = JSON.parse(text).data;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(contract.limits.maxResultBytes);
    expect(data).toMatchObject({ counts: { lookahead: 60, late: 5 }, truncated: true });
    expect(data.activities.length).toBeGreaterThan(5);
    expect(data.activities.length).toBeLessThan(40);
    expect(data.activities.slice(0, 5).every((a: { slippage: string }) => a.slippage === "overdue")).toBe(true);
  });

  it("leaves out an activity whose key is too long rather than cutting it", async () => {
    const long = row(9, "x".repeat(400));
    const data = (await (await read(delegation(), deps(source([long, row(3, "Hang drywall L3")])).d)).json()).data;
    expect(data.activities.map((a: { key: string }) => a.key)).toEqual(["1.3|hang drywall l3"]);
    expect(data.counts.lookahead).toBe(2);
  });

  const refused: [string, Record<string, unknown>][] = [
    ["expired delegation", { expiresAt: NOW }],
    ["lifetime over 10 s", { issuedAt: NOW - 20_000 }],
    ["wrong audience", { audience: "tool.drawings" }],
    ["wrong company", { companyId: "other" }],
    ["another contract", { contractHash: "0".repeat(64) }],
    ["arguments for another project", { arguments: { projectId: 42 } }],
    ["extra argument", { arguments: { projectId: 41, vendor: "x" } }],
    ["a date that is not YYYY-MM-DD", { arguments: { projectId: 41, asOfDate: "11/03/2026" } }],
    ["an impossible date", { arguments: { projectId: 41, asOfDate: "2026-02-30" } }],
    ["a lookahead over 6 weeks", { arguments: { projectId: 41, lookaheadWeeks: 7 } }],
    ["a fractional lookahead", { arguments: { projectId: 41, lookaheadWeeks: 1.5 } }],
    ["extra delegation key", { note: "x" }],
  ];
  it.each(refused)("refuses %s without reading or introspecting", async (_, patch) => {
    const { d, introspected, loaded } = deps();
    const res = await read(delegation(patch), d);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect([introspected.length, loaded.length]).toEqual([0, 0]);
  });

  it("refuses a bad or missing signature", async () => {
    const { d, loaded } = deps();
    expect((await read(delegation(), d, generateKeyPairSync("ed25519").privateKey)).status).toBe(503);
    const { raw } = signed(delegation());
    expect((await handleGatewayRead(raw, null, d)).status).toBe(503);
    const { signature } = signed(delegation());
    expect((await handleGatewayRead(JSON.stringify(delegation({ projectId: 42 })), signature, d)).status).toBe(503);
    expect(loaded).toEqual([]);
  });

  it("refuses when Connect says the delegation is no longer current, before or after the read", async () => {
    const before = deps(undefined, [false]);
    expect((await read(delegation(), before.d)).status).toBe(503);
    expect(before.loaded).toEqual([]);
    const after = deps(undefined, [true, false]);
    expect((await read(delegation(), after.d)).status).toBe(503);
    expect(after.introspected).toHaveLength(2);
  });

  it("answers unavailable when loading fails", async () => {
    const { d } = deps();
    d.load = async () => { throw new Error("db down: postgres://secret"); };
    const res = await read(delegation(), d);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(JSON.stringify({ error: "unavailable" }));
  });
});

describe("gateway read wiring", () => {
  afterEach(() => { delete process.env.SCHEDULE_MANAGER_GATEWAY_READS_ENABLED; });

  it("is public to the middleware (no session) and off by default", async () => {
    const req = new NextRequest(new URL("http://localhost/api/gateway/reads"), { method: "POST" });
    expect((await middleware(req)).headers.get("x-middleware-next")).toBe("1");
    const near = new NextRequest(new URL("http://localhost/api/gateway/readsX"), { method: "POST" });
    expect((await middleware(near)).headers.get("x-middleware-next")).not.toBe("1");
    const { raw, signature } = signed(delegation());
    const res = await POST(new Request("http://localhost/api/gateway/reads", { method: "POST", body: raw, headers: { "X-Connect-Read-Signature": signature } }));
    expect(res.status).toBe(503);
  });

  it("keeps Connect's pinned contract; byte-identical to Connect's copy when CONNECT_SOURCE_ROOT is set", async () => {
    expect(contractHash).toBe("8e3191569748d75811788be4f4840e671a2df9c4e4673c26cd2839556eae7cb4");
    const root = process.env.CONNECT_SOURCE_ROOT;
    if (!root) return;
    const connect = await readFile(resolve(root, "backend/src/core/aiTools/scheduleManagerReadContract.ts"));
    expect(connect.equals(await readFile(resolve(import.meta.dirname, "../lib/gateway/contract.ts")))).toBe(true);
  });
});

describe("Connect signing-key rotation", () => {
  const pem = (k: import("node:crypto").KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
  it("reads every Ed25519 key in the variable, and refuses an empty or mixed value", () => {
    const next = generateKeyPairSync("ed25519");
    expect(connectPublicKeys(pem(publicKey) + pem(next.publicKey))).toHaveLength(2);
    expect(() => connectPublicKeys("")).toThrow();
    expect(() => connectPublicKeys(pem(publicKey) + pem(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey))).toThrow();
  });
  it("accepts a delegation signed by any configured key, and none signed by another", async () => {
    const next = generateKeyPairSync("ed25519");
    const { d } = deps();
    const both = { ...d, publicKeys: [publicKey, next.publicKey] };
    expect((await read(delegation(), both, next.privateKey)).status).toBe(200);
    expect((await read(delegation(), { ...d, publicKeys: [publicKey] }, next.privateKey)).status).toBe(503);
  });
});
