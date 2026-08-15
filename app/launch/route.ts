import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appUrl, osAppOrigins } from "@/lib/http";
import { getProcurementSummary, getProjectContext, getTradePartners } from "@/lib/os-gateway";
import { SCOPE_COOKIE, scopeCookieOptions, signScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// GET /<BASE_PATH>/launch?token=<gatewayToken>&returnUrl=<osOrigin>
//
// The Skiles Connect Tools page navigates the same tab here at launch. The token
// is short-lived (15 min) and proves the OS authorized this person for this
// project; exchanging it for project context is what validates it. We then bind
// the local project to the OS project and issue a session scoped to it.
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const returnUrl = url.searchParams.get("returnUrl") ?? "";
  const osOrigins = osAppOrigins();

  if (!token) return new NextResponse("Missing token", { status: 400 });

  // Open-redirect guard: only bounce back to the OS itself. The origin check is
  // the security boundary; normalising to origin + pathname on top of it drops
  // any attacker-chosen query or fragment, which is the only part of a
  // same-origin URL that could still carry a payload into the OS.
  if (returnUrl && !isOsOrigin(returnUrl, osOrigins)) {
    return new NextResponse("Invalid returnUrl", { status: 400 });
  }
  const safeReturnUrl = returnUrl ? originAndPath(returnUrl) : "";

  let context;
  try {
    context = await getProjectContext(token);
  } catch {
    // Expired or rejected token — send the user back to re-launch from the OS.
    return NextResponse.redirect(safeReturnUrl || osOrigins[0] || appUrl(req, "/login"), 303);
  }

  const osProjectId = context.project?.id;
  const personId = context.person?.id;
  if (typeof osProjectId !== "number" || typeof personId !== "number") {
    return new NextResponse("OS project context was incomplete", { status: 502 });
  }

  // One local project per OS project. Created on first launch so a project team
  // never has to hand-create it; the name is refreshed from the OS, which owns it.
  const project = await prisma.project.upsert({
    where: { osProjectId },
    update: { name: context.project.name },
    create: {
      osProjectId,
      name: context.project.name,
      client: context.project.client ?? null,
    },
  });

  await cacheTradePartners(token, project.id);
  await cacheProcurementRisk(token, project.id);

  const scope = await signScope(
    {
      projectId: project.id,
      osProjectId,
      personId,
      personName: context.person?.displayName ?? null,
      // Backwards-tolerant: an older OS build that hasn't shipped toolLevel yet
      // omits it — least privilege, never admin, until the next launch retries.
      toolLevel: context.access?.toolLevel ?? "viewer",
    },
    Math.floor(Date.now() / 1000)
  );

  const res = NextResponse.redirect(appUrl(req, `/projects/${project.id}`), 303);
  res.cookies.set(SCOPE_COOKIE, scope, scopeCookieOptions());
  // Drop any shared-password session so the two session kinds can't coexist —
  // an unscoped session alongside a scoped one would defeat the scoping.
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

// Launch is the only moment a valid gateway token is in hand, so the roster is
// refreshed here. Failure must not block entry to the tool: a stale roster (or
// the standalone fallback) is better than a dead launch, and the next launch
// retries.
async function cacheTradePartners(token: string, projectId: string): Promise<void> {
  try {
    const feed = await getTradePartners(token);
    await prisma.$transaction([
      prisma.osTradePartner.deleteMany({ where: { projectId } }),
      prisma.osTradePartner.createMany({
        data: feed.tradePartners.map((partner) => ({
          projectId,
          osPartnerId: partner.id,
          name: partner.name,
          doNotUse: partner.doNotUse,
          disciplines: partner.disciplines ?? [],
        })),
      }),
    ]);
  } catch {
    // Keep whatever was cached previously.
  }
}

// Launch is the only moment a valid gateway token is in hand, so procurement
// status is fetched here and cached. Failure must not block entry: no cached
// rows renders as "unknown" on the project page, which is the honest answer, and
// the next launch retries.
async function cacheProcurementRisk(token: string, projectId: string): Promise<void> {
  try {
    const packet = await getProcurementSummary(token);
    await prisma.$transaction([
      prisma.osProcurementRisk.deleteMany({ where: { projectId } }),
      prisma.osProcurementRisk.createMany({
        data: packet.items.map((item) => ({
          projectId,
          osPartnerId: item.osPartnerId,
          partnerName: item.partnerName,
          itemCount: item.itemCount,
          behindCount: item.behindCount,
          submittalLateCount: item.submittalLateCount,
          projectedLateCount: item.projectedLateCount,
          releasedAtRiskCount: item.releasedAtRiskCount,
          missingDatesCount: item.missingDatesCount,
          earliestRequiredOnSite: item.earliestRequiredOnSite ? new Date(item.earliestRequiredOnSite) : null,
          leastAdvancedState: item.leastAdvancedState,
        })),
      }),
    ]);
  } catch {
    // Keep whatever was cached previously.
  }
}

// Strips query and fragment, keeping only the OS origin and path. Called after
// isOsOrigin has already vouched for the origin, so the URL parses.
function originAndPath(candidate: string): string {
  const url = new URL(candidate);
  return `${url.origin}${url.pathname}`;
}

function isOsOrigin(candidate: string, allowedOrigins: string[]): boolean {
  let candidateOrigin: string;
  try {
    candidateOrigin = new URL(candidate).origin;
  } catch {
    return false;
  }
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === candidateOrigin;
    } catch {
      return false;
    }
  });
}
