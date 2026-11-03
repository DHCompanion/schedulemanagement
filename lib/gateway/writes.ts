// Connect's signed agent draft write (connect.tool.write/1): POST /api/gateway/writes. Same trust as the read: the
// Ed25519 signature over the raw bytes is the only credential, and Connect must confirm the delegation is still
// current before anything is saved. A refusal (stale, invalid, ...) is a normal answer the agent relays; only a
// failed check or an error is "unavailable".
import type { KeyObject } from "node:crypto";
import { scheduleDraftWriteContract as contract, scheduleDraftWriteContractHash as contractHash } from "./writeContract";
import { COMPANY_ID, isRecord, keys, stillCurrent, verifyDelegation, type DelegationSpec } from "./reads";
import type { DraftWriteInput, DraftWriteResult, Writer } from "./draftWrite";

const text = (v: unknown, max: number) => typeof v === "string" && v.length >= 1 && v.length <= max;
const dateOrNull = (v: unknown) => v === null || (typeof v === "string" && v.length === 10);
const STATUSES = new Set(["not_started", "in_progress", "complete"]);
const progress = (p: unknown) => isRecord(p) && STATUSES.has(p.status as string) &&
  (p.percentComplete === null || (Number.isInteger(p.percentComplete) && (p.percentComplete as number) >= 0 && (p.percentComplete as number) <= 100)) &&
  dateOrNull(p.actualStart) && dateOrNull(p.actualFinish);
const PROGRESS_KEYS = "actualFinish,actualStart,percentComplete,status", ENTRY_KEYS = "actualFinish,actualStart,expectedDraft,key,percentComplete,status";

/** The contract's input shape, checked here too: the schema subset Connect enforces has no date pattern. */
const writeSpec: DelegationSpec = {
  protocol: "connect.tool.write/1", contract, contractHash,
  argumentsValid: (a) =>
    Object.keys(a).every((k) => ["projectId", "idempotencyKey", "asOfDate", "expectedDraftAsOfDate", "entries"].includes(k)) &&
    typeof a.idempotencyKey === "string" && a.idempotencyKey.length >= 8 && a.idempotencyKey.length <= 100 &&
    (a.asOfDate === undefined || (typeof a.asOfDate === "string" && a.asOfDate.length === 10)) && dateOrNull(a.expectedDraftAsOfDate) &&
    Array.isArray(a.entries) && a.entries.length <= 15 &&
    a.entries.every((e) => isRecord(e) && keys(e) === ENTRY_KEYS && text(e.key, 300) && progress(e) &&
      (e.expectedDraft === null || (isRecord(e.expectedDraft) && keys(e.expectedDraft) === PROGRESS_KEYS && progress(e.expectedDraft)))),
};

export type WriteDeps = {
  publicKey: KeyObject;
  connectOrigin: string;
  save: (osProjectId: number, input: DraftWriteInput, who: Writer) => Promise<DraftWriteResult>;
  /** Told about each saved write (the route tells Connect after responding); never awaited for the answer. */
  afterSave?: (osProjectId: number, requestId: string, data: DraftWriteResult) => void;
  fetch?: typeof fetch;
  now?: () => number;
};
const unavailable = () => Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

export async function handleGatewayWrite(raw: string, signature: string | null, deps: WriteDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  try {
    const d = verifyDelegation(raw, signature, deps.publicKey, now(), writeSpec);
    if (!d || !Number.isSafeInteger(d.personId) || d.personId < 1 || !text(d.agentId, 100) || !text(d.clientKey, 40)) return unavailable();
    // Current means authorized, not revoked, and still the pending attempt for its key.
    if (!(await stillCurrent(raw, signature!, deps, d.expiresAt)) || now() >= d.expiresAt) return unavailable();
    const data = await deps.save(d.projectId, d.arguments as unknown as DraftWriteInput, { personId: d.personId, agentId: d.agentId, clientKey: d.clientKey });
    if (data.saved) deps.afterSave?.(d.projectId, d.requestId, data);
    return Response.json({
      schemaVersion: "connect.tool.result/2", requestId: d.requestId, actionId: contract.id, contractHash,
      companyId: COMPANY_ID, projectId: d.projectId, dataMode: "live", data,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
