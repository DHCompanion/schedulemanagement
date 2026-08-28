import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { GET } from "@/app/launch/route";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appPath, appUrl, osAppOrigins } from "@/lib/http";
import { SCOPE_COOKIE, readScope } from "@/lib/scope";

const OS_ORIGIN = "https://sgconnect.dev";

function launchRequest(query: string): Request {
  return new Request(`https://tool.internal/launch${query}`, {
    headers: { "x-forwarded-host": "schedule-manager.vercel.app", "x-forwarded-proto": "https" },
  });
}

function stubGateway(ok: boolean) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => ({ project: { id: 5 } }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubGatewayContext(osProjectId: number, name: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      project: { id: osProjectId, name, client: "BSW" },
      person: { id: 4, displayName: "A. Woodyard" },
      access: { toolLevel: "admin" },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = "/schedule-manager";
  process.env.APP_BASE_URL = "https://sgconnect.dev/schedule-manager";
  process.env.SKILES_OS_APP_ORIGIN = `https://www.sgconnect.dev, ${OS_ORIGIN}`;
  process.env.SKILES_OS_API_BASE_URL = "https://api.sgconnect.dev/api";
  process.env.SESSION_SIGNING_SECRET = "token-abc".padEnd(32, "x");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base-path aware URLs", () => {
  it("prefixes raw API paths, which Next's basePath does not cover", () => {
    expect(appPath("/api/trades")).toBe("/schedule-manager/api/trades");
  });

  it("is a no-op when the tool runs standalone", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    expect(appPath("/api/trades")).toBe("/api/trades");
  });

  it("redirects through APP_BASE_URL so the user stays behind the OS proxy", () => {
    expect(appUrl(launchRequest(""), "/projects/1")).toBe("https://sgconnect.dev/schedule-manager/projects/1");
  });

  it("parses the OS origin allowlist, trimming and dropping blanks", () => {
    process.env.SKILES_OS_APP_ORIGIN = "https://www.sgconnect.dev , https://sgconnect.dev ,";
    expect(osAppOrigins()).toEqual(["https://www.sgconnect.dev", "https://sgconnect.dev"]);
    delete process.env.SKILES_OS_APP_ORIGIN;
    expect(osAppOrigins()).toEqual([]);
  });

  it("names the variable when APP_BASE_URL is malformed", () => {
    process.env.APP_BASE_URL = 'https"//sgconnect.dev/schedule-manager';
    expect(() => appUrl(launchRequest(""), "/projects/1")).toThrow(/APP_BASE_URL/);
  });

  it("falls back to the forwarded host plus base path when APP_BASE_URL is unset", () => {
    delete process.env.APP_BASE_URL;
    expect(appUrl(launchRequest(""), "/projects/1")).toBe(
      "https://schedule-manager.vercel.app/schedule-manager/projects/1"
    );
  });
});

describe("middleware coverage", () => {
  it("matches the bare root explicitly", async () => {
    // Under BASE_PATH the bare base path (no trailing slash) does not match the
    // catch-all pattern, so middleware is skipped and the page renders to an
    // anonymous request. Verified against a running build; this pins the fix.
    const { config } = await import("@/middleware");
    expect(config.matcher).toContain("/");
  });
});

describe("OS launch handoff", () => {
  it("rejects a launch with no gateway token", async () => {
    const res = await GET(launchRequest(""));
    expect(res.status).toBe(400);
  });

  it("rejects a returnUrl pointing off the OS origin", async () => {
    const res = await GET(launchRequest("?token=t&returnUrl=https://evil.example/steal"));
    expect(res.status).toBe(400);
  });

  it("accepts every configured OS origin", async () => {
    // Production serves www while the apex redirects to it, so the OS builds a
    // www returnUrl. Accepting only one of them 400d every real launch.
    for (const origin of ["https://www.sgconnect.dev", OS_ORIGIN]) {
      stubGateway(false);
      const res = await GET(launchRequest(`?token=t&returnUrl=${origin}/tools`));
      expect(res.status, `${origin} should pass the guard`).toBe(303);
    }
  });

  it("still rejects a lookalike host", async () => {
    const res = await GET(launchRequest("?token=t&returnUrl=https://sgconnect.dev.evil.example/tools"));
    expect(res.status).toBe(400);
  });

  it("sends the user back to the OS when the token is rejected", async () => {
    stubGateway(false);
    const res = await GET(launchRequest(`?token=expired&returnUrl=${OS_ORIGIN}/tools`));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${OS_ORIGIN}/tools`);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

// The success path binds a local project to the OS project, so it needs the DB.
describe.runIf(!!process.env.DATABASE_URL)("OS launch binds a project", () => {
  const osProjectId = 987654;

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { osProjectId } });
    await prisma.$disconnect();
  });

  it("creates the project on first launch and scopes the session to it", async () => {
    const fetchMock = stubGatewayContext(osProjectId, "Downtown Hospital Renovation");
    const res = await GET(launchRequest(`?token=t&returnUrl=${OS_ORIGIN}/tools`));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sgconnect.dev/api/tool-gateway/project-context",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer t" }) })
    );

    const project = await prisma.project.findUnique({ where: { osProjectId } });
    expect(project?.name).toBe("Downtown Hospital Renovation");

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `https://sgconnect.dev/schedule-manager/projects/${project?.id}`
    );

    const scope = await readScope(res.cookies.get(SCOPE_COOKIE)?.value, Math.floor(Date.now() / 1000));
    // personName rides along so the project banner can name who is signed in;
    // toolLevel is the OS's single already-resolved authority signal.
    expect(scope).toMatchObject({
      projectId: project?.id, osProjectId, personId: 4,
      personName: "A. Woodyard", toolLevel: "admin",
    });
    // The shared-password session is cleared: an unscoped session sitting
    // alongside a scoped one would defeat the scoping.
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("reuses the same local project on a second launch", async () => {
    stubGatewayContext(osProjectId, "Downtown Hospital Renovation (renamed)");
    await GET(launchRequest(`?token=t&returnUrl=${OS_ORIGIN}/tools`));

    expect(await prisma.project.count({ where: { osProjectId } })).toBe(1);
    const project = await prisma.project.findUnique({ where: { osProjectId } });
    expect(project?.name).toBe("Downtown Hospital Renovation (renamed)");
  });

  it("scopes to viewer, never admin, when an older OS build omits toolLevel", async () => {
    const olderOsProjectId = 987655;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        project: { id: olderOsProjectId, name: "Legacy OS Build", client: "BSW" },
        person: { id: 4, displayName: "A. Woodyard" },
        access: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(launchRequest(`?token=t&returnUrl=${OS_ORIGIN}/tools`));
    const scope = await readScope(res.cookies.get(SCOPE_COOKIE)?.value, Math.floor(Date.now() / 1000));
    expect(scope?.toolLevel).toBe("viewer");

    await prisma.project.deleteMany({ where: { osProjectId: olderOsProjectId } });
  });
});

function stubLaunchGateway(osProjectId: number, opts: { procurement: "ok" | "fail" }) {
  const fetchMock = vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes("/context-requests")) {
      if (opts.procurement === "fail") throw new Error("procurement unreachable");
      return {
        ok: true,
        json: async () => ({
          packetType: "procurement_project_summary",
          projectId: osProjectId,
          items: [
            {
              osPartnerId: 77, partnerName: "Amber Electrical Contractors, Inc.",
              itemCount: 12, earliestRequiredOnSite: "2026-08-04T00:00:00.000Z",
              leastAdvancedState: "submitted",
              behindCount: 3, submittalLateCount: 2, projectedLateCount: 1,
              releasedAtRiskCount: 1, missingDatesCount: 0,
            },
            {
              osPartnerId: 91, partnerName: "Carrco Painting Contractors, Inc.",
              itemCount: 4, earliestRequiredOnSite: null,
              leastAdvancedState: "delivered",
              behindCount: 0, submittalLateCount: 0, projectedLateCount: 0,
              releasedAtRiskCount: 0, missingDatesCount: 4,
            },
          ],
          summary: {}, warnings: [],
        }),
      };
    }
    if (target.includes("/trade-partners")) {
      return { ok: true, json: async () => ({ projectId: osProjectId, tradePartners: [] }) };
    }
    return {
      ok: true,
      json: async () => ({
        project: { id: osProjectId, name: "BSW Regional ED", client: "BSW" },
        person: { id: 4, displayName: "A. Woodyard" },
        access: { toolLevel: "user" },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe.runIf(!!process.env.DATABASE_URL)("procurement risk cache", () => {
  const osProjectIds = [4101, 4102, 4103];

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { osProjectId: { in: osProjectIds } } });
    await prisma.$disconnect();
  });

  it("caches every partner returned, flagged or not", async () => {
    stubLaunchGateway(4101, { procurement: "ok" });
    await GET(launchRequest("?token=t"));

    const project = await prisma.project.findUnique({ where: { osProjectId: 4101 } });
    const rows = await prisma.osProcurementRisk.findMany({
      where: { projectId: project!.id },
      orderBy: { osPartnerId: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].osPartnerId).toBe(77);
    expect(rows[0].behindCount).toBe(3);
    expect(rows[0].submittalLateCount).toBe(2);
    expect(rows[0].projectedLateCount).toBe(1);
    expect(rows[0].earliestRequiredOnSite?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    // Unflagged partners are stored too: their presence is what proves the
    // project was checked at all. Carrco is not behind, but all four of its
    // items lack the dates to assess — a different thing, and cached as such.
    expect(rows[1].behindCount).toBe(0);
    expect(rows[1].missingDatesCount).toBe(4);
    expect(rows[1].earliestRequiredOnSite).toBeNull();
  });

  it("completes the launch when procurement is unreachable", async () => {
    stubLaunchGateway(4102, { procurement: "fail" });
    const res = await GET(launchRequest("?token=t"));

    expect(res.status).toBe(303);
    expect(res.cookies.get(SCOPE_COOKIE)?.value).toBeTruthy();
    const project = await prisma.project.findUnique({ where: { osProjectId: 4102 } });
    expect(project).not.toBeNull();
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(0);
  });

  it("keeps the previous cache when the packet comes back empty", async () => {
    // The cache is now upsert-by-partner, not delete-then-recreate: a packet
    // with no items touches no rows, so a transient "nothing to report" answer
    // can't wipe out a good cache. The previous rows (and their honest "as of"
    // timestamp) stay in place for the next successful refresh to update.
    stubLaunchGateway(4103, { procurement: "ok" });
    await GET(launchRequest("?token=t"));
    const project = await prisma.project.findUnique({ where: { osProjectId: 4103 } });
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(2);

    vi.unstubAllGlobals();
    const emptyMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/context-requests")) {
        return { ok: true, json: async () => ({ packetType: "procurement_project_summary", projectId: 4103, items: [], summary: {}, warnings: ["No procurement project is linked to this Connect project yet."] }) };
      }
      if (target.includes("/trade-partners")) return { ok: true, json: async () => ({ projectId: 4103, tradePartners: [] }) };
      return { ok: true, json: async () => ({ project: { id: 4103, name: "BSW Regional ED" }, person: { id: 4 }, access: { toolLevel: "user" } }) };
    });
    vi.stubGlobal("fetch", emptyMock);

    await GET(launchRequest("?token=t"));
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(2);
  });
});
