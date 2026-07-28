import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { getProjectContext, getTradePartners } from "@/lib/os-gateway";
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
  const osOrigins = allowedOsOrigins();

  if (!token) return new NextResponse("Missing token", { status: 400 });

  // Open-redirect guard: only bounce back to the OS itself.
  if (returnUrl && !isOsOrigin(returnUrl, osOrigins)) {
    return new NextResponse("Invalid returnUrl", { status: 400 });
  }

  let context;
  try {
    context = await getProjectContext(token);
  } catch {
    // Expired or rejected token — send the user back to re-launch from the OS.
    return NextResponse.redirect(returnUrl || osOrigins[0] || appUrl(req, "/login"), 303);
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

  const scope = await signScope(
    {
      projectId: project.id,
      osProjectId,
      personId,
      accessRole: context.access?.accessRole ?? null,
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

// SKILES_OS_APP_ORIGIN is a comma-separated list. One value was too rigid: the OS
// builds returnUrl from window.location.origin, production serves www but the
// apex is what was configured, and every launch 400d. Preview deployments of the
// OS are a third legitimate origin. Matching is still an exact origin comparison
// against the list — this widens what counts as "the OS", not the guard itself.
function allowedOsOrigins(): string[] {
  return (process.env.SKILES_OS_APP_ORIGIN ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
