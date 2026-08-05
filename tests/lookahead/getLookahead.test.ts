import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getLookahead, parseWeeks, parseSize } from "@/lib/lookahead/getLookahead";

describe("param parsing", () => {
  it("defaults to a 3-week tabloid sheet and accepts only the known widenings", () => {
    expect(parseWeeks(undefined)).toBe(3);
    expect(parseWeeks("6")).toBe(6);
    expect(parseWeeks("9")).toBe(3);
    expect(parseSize(undefined)).toBe("tabloid");
    expect(parseSize("letter")).toBe("letter");
    expect(parseSize("a4")).toBe("tabloid");
  });
});

describe.runIf(!!process.env.DATABASE_URL)("getLookahead", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null without an import and a banded view once one exists", async () => {
    const project = await prisma.project.create({ data: { name: "Lookahead Test" } });
    projectId = project.id;
    expect(await getLookahead(project.id, 3, new Date("2026-08-05T12:00:00Z"))).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "lh-h",
        statusDate: new Date("2026-08-04T17:00:00Z"), minutesPerDay: 480,
      },
    });
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|lh", name: "Overhead MEP", type: "task",
        wbsCode: "1.1", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
        durationDays: 5, percentComplete: 0, outlineLevel: 2,
      },
    });

    const out = await getLookahead(project.id, 3, new Date("2026-08-05T12:00:00Z"));
    expect(out).not.toBeNull();
    expect(out!.projectName).toBe("Lookahead Test");
    expect(out!.view.title).toBe("3-Week Lookahead");
    expect(out!.view.bands.flatMap((b) => b.rows).map((r) => r.name)).toEqual(["Overhead MEP"]);
  });

  it("returns null for a project that does not exist", async () => {
    expect(await getLookahead("no-such-project", 6, new Date("2026-08-05T12:00:00Z"))).toBeNull();
  });
});
