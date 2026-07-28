import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// Cached in production too, not just in dev. On Vercel a warm function instance
// serves many invocations; constructing a client per invocation would open a new
// pool each time and exhaust Postgres connections.
globalForPrisma.prisma = prisma;
