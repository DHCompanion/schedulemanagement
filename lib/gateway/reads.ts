// Connect's signed agent read (MCP plan Phase 4b): POST /api/gateway/reads.
// Connect signs the delegation's raw bytes with Ed25519; that signature is the only
// credential. We check it, ask Connect whether the delegation is still current before
// and after reading, and answer with Schedule Manager-owned data only (never procurement).
// Every failure is the same "unavailable": the agent learns nothing from why.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { scheduleUpdateStateContract as contract, scheduleUpdateStateContractHash as contractHash } from "./contract";
import { parseDay, toResult, type UpdateStateInput, type UpdateStateSource } from "./updateState";

export const COMPANY_ID = "skiles-group";
const MAX_BODY_BYTES = 4096; // Connect's introspection accepts no more
const MAX_LIFETIME_MS = 10_000;
const DELEGATION_KEYS = "actionId,agentId,arguments,audience,authorizationGeneration,clientKey,companyId,consentBinding,contractHash,expiresAt,issuedAt,personId,projectId,protocol,requestId,version";
const ARGUMENT_KEYS = new Set(["projectId", "asOfDate", "lookaheadWeeks"]);

export type Delegation = { requestId: string; projectId: number; expiresAt: number; personId: number; agentId: string; clientKey: string; arguments: { projectId: number } & UpdateStateInput };
export type ReadDeps = {
  /** Connect's signing keys: one normally, two during a key rotation. */
  publicKeys: readonly KeyObject[];
  connectOrigin: string;
  load: (osProjectId: number, input: UpdateStateInput) => Promise<UpdateStateSource>;
  fetch?: typeof fetch;
  now?: () => number;
};

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const keys = (v: Record<string, unknown>) => Object.keys(v).sort().join(",");
const unavailable = () => Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

/** What one gateway route accepts: its protocol, its reviewed contract, and a check of the arguments' values. */
export type DelegationSpec = { protocol: string; contract: { id: string; version: string; ownerId: string; limits: { maxInputBytes: number } }; contractHash: string; argumentsValid: (a: Record<string, unknown>) => boolean };
const readSpec: DelegationSpec = {
  protocol: "connect.tool.read/2", contract, contractHash,
  argumentsValid: (a) => Object.keys(a).every((k) => ARGUMENT_KEYS.has(k)) &&
    (a.asOfDate === undefined || (typeof a.asOfDate === "string" && parseDay(a.asOfDate) !== null)) &&
    (a.lookaheadWeeks === undefined || (Number.isSafeInteger(a.lookaheadWeeks) && (a.lookaheadWeeks as number) >= 1 && (a.lookaheadWeeks as number) <= 6)),
};

/** Every public key in SCHEDULE_MANAGER_GATEWAY_CONNECT_PUBLIC_KEY: one PEM block normally, two during a Connect
 * key rotation (old and new). At least one, all Ed25519, or this throws (the route then answers unavailable). */
export function connectPublicKeys(pem: string): KeyObject[] {
  const keys = (pem.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? []).map((block) => createPublicKey(block));
  if (!keys.length || keys.some((k) => k.asymmetricKeyType !== "ed25519")) throw Error("Connect public key unavailable");
  return keys;
}

/** The delegation, if the signature, audience, company, contract, lifetime and arguments all hold. */
export function verifyDelegation(raw: string, signature: string | null, publicKeys: readonly KeyObject[], now: number, spec: DelegationSpec = readSpec): Delegation | null {
  if (!signature || !/^[A-Za-z0-9_-]{86}$/.test(signature) || Buffer.byteLength(raw) > MAX_BODY_BYTES) return null;
  const bytes = Buffer.from(raw), sig = Buffer.from(signature, "base64url");
  if (!publicKeys.some((key) => verify(null, bytes, key, sig))) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!isRecord(d) || keys(d) !== DELEGATION_KEYS) return null;
  const a = d.arguments;
  const ok =
    d.protocol === spec.protocol && d.audience === spec.contract.ownerId && d.companyId === COMPANY_ID &&
    d.actionId === spec.contract.id && d.version === spec.contract.version && d.contractHash === spec.contractHash &&
    typeof d.requestId === "string" && d.requestId.length > 0 && d.requestId.length <= 100 &&
    Number.isSafeInteger(d.projectId) && (d.projectId as number) >= 1 &&
    typeof d.issuedAt === "number" && typeof d.expiresAt === "number" &&
    d.expiresAt > now && d.issuedAt <= now + 5_000 && d.expiresAt - d.issuedAt <= MAX_LIFETIME_MS &&
    isRecord(a) && a.projectId === d.projectId && spec.argumentsValid(a) &&
    Buffer.byteLength(JSON.stringify(a)) <= spec.contract.limits.maxInputBytes;
  return ok ? (d as unknown as Delegation) : null;
}

export async function stillCurrent(raw: string, signature: string, deps: Pick<ReadDeps, "connectOrigin" | "fetch" | "now">, deadline: number): Promise<boolean> {
  try {
    const res = await (deps.fetch ?? fetch)(`${deps.connectOrigin}/internal/ai-tool-reads/introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Connect-Read-Signature": signature },
      body: raw,
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, deadline - (deps.now ?? Date.now)())),
    });
    const body: unknown = res.ok ? await res.json() : null;
    return isRecord(body) && body.current === true;
  } catch {
    return false;
  }
}

export async function handleGatewayRead(raw: string, signature: string | null, deps: ReadDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  try {
    const d = verifyDelegation(raw, signature, deps.publicKeys, now());
    if (!d || !(await stillCurrent(raw, signature!, deps, d.expiresAt))) return unavailable();
    const envelope = (data: unknown) => ({
      schemaVersion: "connect.tool.result/2", requestId: d.requestId, actionId: contract.id, contractHash,
      companyId: COMPANY_ID, projectId: d.projectId, dataMode: "live", data,
    });
    // Connect caps the whole response body in UTF-8, envelope included.
    const fits = (data: unknown) => Buffer.byteLength(JSON.stringify(envelope(data))) <= contract.limits.maxResultBytes;
    const { asOfDate, lookaheadWeeks } = d.arguments;
    const data = toResult(await deps.load(d.projectId, { asOfDate, lookaheadWeeks }), fits);
    if (!fits(data) || now() >= d.expiresAt || !(await stillCurrent(raw, signature!, deps, d.expiresAt))) return unavailable();
    return Response.json(envelope(data), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
