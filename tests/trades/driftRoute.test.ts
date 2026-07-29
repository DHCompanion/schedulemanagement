import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("trade drift route", () => {
  const created: string[] = [];
  const disciplineId = 990001;

  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  async function makeProject() {
    const project = await prisma.project.create({ data: { name: `ZZ Drift Route ${Date.now()}` } });
    created.push(project.id);
    await prisma.osTradePartner.create({
      data: {
        projectId: project.id,
        osPartnerId: 4242,
        name: "On Roster Co",
        disciplines: [{ id: disciplineId, name: "99A: TEST", division: "" }],
      },
    });
    return project.id;
  }

  function post(body: unknown) {
    return new Request("http://localhost/api/trades/drift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a malformed body", async () => {
    const { POST } = await import("@/app/api/trades/drift/route");
    const res = await POST(post({ projectId: "x", osDisciplineId: 1, fileValue: "  ", action: "keep" }));
    expect(res.status).toBe(422);
  });

  it("rejects an unknown action rather than treating it as a dismissal", async () => {
    const { POST } = await import("@/app/api/trades/drift/route");
    const res = await POST(post({ projectId: "x", osDisciplineId: 1, fileValue: "Someone", action: "delete" }));
    expect(res.status).toBe(422);
  });

  it("keeping the tool's value records a dismissal for that exact file value", async () => {
    const projectId = await makeProject();
    const { POST } = await import("@/app/api/trades/drift/route");

    const res = await POST(post({ projectId, osDisciplineId: disciplineId, fileValue: "Off Roster Co", action: "keep" }));
    expect(res.status).toBe(200);

    const rows = await prisma.tradeDriftDismissal.findMany({ where: { projectId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].fileValue).toBe("Off Roster Co");
    // Repeating is idempotent, not a unique-constraint crash.
    expect((await POST(post({ projectId, osDisciplineId: disciplineId, fileValue: "Off Roster Co", action: "keep" }))).status).toBe(200);
    expect(await prisma.tradeDriftDismissal.count({ where: { projectId } })).toBe(1);
  }, 30000);

  it("refuses to accept a partner Connect does not have on the project", async () => {
    const projectId = await makeProject();
    const { POST } = await import("@/app/api/trades/drift/route");

    const res = await POST(post({ projectId, osDisciplineId: disciplineId, fileValue: "Nobody Ltd", action: "accept" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("Nobody Ltd");
    // Nothing was invented.
    expect(await prisma.projectTradeAssignment.count({ where: { projectId } })).toBe(0);
  }, 30000);

  it("accepting a roster partner reassigns the discipline and clears its rulings", async () => {
    const projectId = await makeProject();
    const { POST } = await import("@/app/api/trades/drift/route");

    await POST(post({ projectId, osDisciplineId: disciplineId, fileValue: "Some Other Co", action: "keep" }));
    expect(await prisma.tradeDriftDismissal.count({ where: { projectId } })).toBe(1);

    const res = await POST(post({ projectId, osDisciplineId: disciplineId, fileValue: "On Roster Co", action: "accept" }));
    expect(res.status).toBe(200);

    const assignment = await prisma.projectTradeAssignment.findFirstOrThrow({ where: { projectId } });
    expect(assignment.osPartnerId).toBe(4242);
    expect(assignment.partnerName).toBe("On Roster Co");
    // The disagreement is settled, so the earlier ruling is spent — leaving it
    // would suppress a genuinely new edit later.
    expect(await prisma.tradeDriftDismissal.count({ where: { projectId } })).toBe(0);
  }, 30000);
});
