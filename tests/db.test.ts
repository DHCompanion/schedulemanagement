import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("database", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and reads a project", async () => {
    const p = await prisma.project.create({ data: { name: "Test Project" } });
    const found = await prisma.project.findUnique({ where: { id: p.id } });
    expect(found?.name).toBe("Test Project");
    await prisma.project.delete({ where: { id: p.id } });
  });
});
