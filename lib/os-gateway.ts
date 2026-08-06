// Minimal Skiles Connect Tool Gateway client.
//
// SKILES_OS_API_BASE_URL must END IN /api and point at the OS *backend*
// (api.sgconnect.dev), never the frontend — this client appends
// `/tool-gateway/...`, and the two must combine to
// https://api.sgconnect.dev/api/tool-gateway/... A missing scheme or a wrong
// /api segment fails silently at launch.
//
// The OS derives projectId/personId/sourceTool/createdBy/requestedBy from the
// signed token — never send those in a write body.

export type OsProjectContext = {
  project: { id: number; name: string; projectNumber?: string | null; client?: string | null; status?: string | null };
  // roleProfile is the person's org-wide role, unlike access.accessRole which is
  // per project — the only field in this payload that can carry "OS admin".
  person: { id: number; displayName?: string | null; roleTitle?: string | null; roleProfile?: string | null };
  access: { accessRole?: string | null };
  session: { toolSlug: string; personId: number; projectId: number; osCapabilities: string[]; expiresAt: string };
};

async function call(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const base = process.env.SKILES_OS_API_BASE_URL;
  if (!base) throw new Error("SKILES_OS_API_BASE_URL is not set");
  const res = await fetch(`${base.replace(/\/+$/, "")}/tool-gateway${path}`, {
    ...init,
    cache: "no-store",
    // Bound every gateway call. Launch awaits these sequentially before it can
    // redirect the user into the tool; a hung upstream (the OS itself, or for
    // procurement, the OS's own server-to-server hop) must not be able to stall
    // that longer than the platform's own request timeout would anyway.
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`tool-gateway ${path} -> ${res.status}`);
  return res.json();
}

// Validating the launch token and reading scoped context are the same call: the
// OS re-checks the tool, person, project, and access on every gateway request.
export async function getProjectContext(token: string): Promise<OsProjectContext> {
  return (await call("/project-context", token)) as OsProjectContext;
}

export type OsTradePartnerFeed = {
  projectId: number;
  tradePartners: {
    id: number;
    name: string;
    doNotUse: boolean;
    disciplines: { id: number; name: string; division: string }[];
  }[];
};

// The OS is the system of record for a project's trade partner roster. Its
// payload carries contacts and MSA/prequal flags too; this tool reads only what
// it renders.
export async function getTradePartners(token: string): Promise<OsTradePartnerFeed> {
  return (await call("/trade-partners", token)) as OsTradePartnerFeed;
}

// One row per trade partner, mirroring the grain of the packet this tool serves
// in the other direction. A packet "item" is a partner, not a procurement item —
// the OS caps items at 25, and a project runs 10-15 trade partners, so the whole
// project fits inside the cap. `itemCount` below is that partner's procurement
// items, which is the overloaded half of the name.
//
// The counts are per-status tallies procurement derives; `behindCount` is
// `submittalLateCount + projectedLateCount` and is what flags a partner here.
export type OsProcurementRiskItem = {
  osPartnerId: number;
  partnerName: string;
  itemCount: number;
  earliestRequiredOnSite: string | null;
  leastAdvancedState: string;
  behindCount: number;
  submittalLateCount: number;
  projectedLateCount: number;
  releasedAtRiskCount: number;
  missingDatesCount: number;
};

export type OsProcurementSummary = {
  packetType: string;
  projectId: number;
  items: OsProcurementRiskItem[];
  summary: Record<string, unknown>;
  warnings: string[];
};

// OS-mediated read of the procurement tool's project summary. Neither tool calls
// the other: the OS authorizes the request, calls procurement server-to-server,
// and hands back the payload. An empty `items` with a warning is a normal answer.
export async function getProcurementSummary(token: string): Promise<OsProcurementSummary> {
  return (await call("/context-requests", token, {
    method: "POST",
    body: JSON.stringify({
      target: "procurement-manager",
      packetType: "procurement_project_summary",
      limit: 25,
    }),
  })) as OsProcurementSummary;
}
