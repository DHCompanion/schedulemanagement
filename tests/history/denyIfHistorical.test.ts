import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { denyIfHistorical } from "@/lib/historical";

describe.runIf(!!process.env.DATABASE_URL)("denyIfHistorical", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("refuses a historical project and lets a live one through", async () => {
    const old = await prisma.project.create({ data: { name: "Old", status: "historical" } });
    const live = await prisma.project.create({ data: { name: "Live" } });
    ids.push(old.id, live.id);
    expect((await denyIfHistorical(old.id))?.status).toBe(403);
    expect(await denyIfHistorical(live.id)).toBeNull();
  });
});

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : /^route\.tsx?$/.test(name) ? [path] : [];
  });
}

// Every route that checks project scope acts on one project's data, so each must
// also refuse a historical project (Q51: no edits, updates or export).
describe("project-scoped API routes", () => {
  it("all call denyIfHistorical", () => {
    const missing = routes("app/api").filter((p) => {
      const src = readFileSync(p, "utf8");
      return /denyIfOutOfScope|denyOutOfScope/.test(src) && !src.includes("denyIfHistorical");
    });
    expect(missing).toEqual([]);
  });
});
