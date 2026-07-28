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
  person: { id: number; displayName?: string | null; roleTitle?: string | null };
  access: { accessRole?: string | null };
  session: { toolSlug: string; personId: number; projectId: number; osCapabilities: string[]; expiresAt: string };
};

async function call(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const base = process.env.SKILES_OS_API_BASE_URL;
  if (!base) throw new Error("SKILES_OS_API_BASE_URL is not set");
  const res = await fetch(`${base.replace(/\/+$/, "")}/tool-gateway${path}`, {
    ...init,
    cache: "no-store",
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
