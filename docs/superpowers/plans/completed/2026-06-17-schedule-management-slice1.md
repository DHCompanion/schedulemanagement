# Schedule Management — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a Microsoft Project XML schedule into a normalized, versioned PostgreSQL model and present a mobile-first verification view so a scheduler can confirm the import matches the source file.

**Architecture:** Standalone Next.js 14 (App Router) app. Pure, fully-unit-tested MSPDI parser (`lib/msp/*`) converts XML → an in-memory `ParsedSchedule`. A transactional `commitImport` writes that to Postgres via Prisma as an immutable `ScheduleImport` snapshot. Server components read the latest snapshot; a client component handles search/filter/sort. A shared-password middleware gates everything.

**Tech Stack:** Next.js 14, React 18, TypeScript 5, Tailwind CSS 3, Prisma 5 + PostgreSQL, fast-xml-parser 4, Vitest 2.

## Global Constraints

- Node `>=20`.
- Next.js `14.x` (App Router), React `18.x`, TypeScript `5.x` strict mode — never use `any` to silence type errors (the parser uses narrow helper casts only at the XML boundary).
- Prisma `5.x`, `provider = "postgresql"`, `DATABASE_URL` from env. Migrations are the schema source of truth.
- fast-xml-parser `4.x`.
- Vitest `2.x` for tests.
- No `console.log` in committed code — throw typed errors or return structured results.
- All canonical rows use cuid IDs. Each import is an **immutable snapshot**; never mutate prior snapshots.
- MSPDI datetimes are naive local — store wall-clock deterministically (append `Z`, treat as UTC), never timezone-shift.
- Slack/lag numeric duration fields are integer **tenths of a minute**; ISO `PT#H#M#S` fields are durations to be parsed to minutes.
- Single-line shell commands only (TrueNAS code-server); no `\` continuations, no heredocs.
- Repo root: `/home/coder/projects/Skilesconnect/schedulemanagement`. All paths below are relative to it.

---

## File Structure

```
schedulemanagement/
  package.json, tsconfig.json, next.config.mjs, postcss.config.js,
  tailwind.config.ts, vitest.config.ts, .env.example, .gitignore, middleware.ts
  prisma/schema.prisma
  lib/
    db.ts                      # Prisma client singleton
    auth.ts                    # shared-password helpers (pure)
    msp/
      types.ts                 # ParsedSchedule + sub-types
      duration.ts              # ISO duration + tenths-of-minute conversions
      relationshipType.ts      # 0/1/2/3 -> FS/SS/FF/SF
      hierarchy.ts             # parent derivation from outline levels
      canonicalKey.ts          # canonicalActivityKey
      parseMspXml.ts           # XML -> ParsedSchedule
    import/commitImport.ts     # ParsedSchedule -> DB snapshot (transactional)
  app/
    layout.tsx, globals.css, page.tsx          # projects list
    login/page.tsx
    api/login/route.ts
    api/projects/route.ts
    api/imports/preview/route.ts
    api/imports/commit/route.ts
    projects/new/page.tsx
    projects/[id]/page.tsx                      # verification view (server)
    projects/[id]/import/page.tsx               # import wizard (client)
  components/
    ActivityTable.tsx          # client: search/filter/sort/group + detail expand
    ImportWizard.tsx           # client: upload -> preview -> confirm -> commit
  tests/
    fixtures/minimal.xml       # tiny synthetic MSPDI doc
    msp/*.test.ts              # unit tests
    import/commitImport.test.ts# integration (needs DATABASE_URL)
```

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.js`, `tailwind.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Next.js app and a working `npm test` (Vitest) command.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "schedulemanagement",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "fast-xml-parser": "^4.5.0",
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "prisma": "^5.22.0",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`postcss.config.js`:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

`.gitignore`:
```
node_modules
.next
.env
.env.local
next-env.d.ts
*.tsbuildinfo
```

`.env.example`:
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB"
APP_PASSWORD="change-me"
APP_SESSION_TOKEN="generate-a-long-random-string"
```

- [ ] **Step 3: Create app shell**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Schedule Management" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
```

`app/page.tsx` (temporary placeholder, replaced in Task 9):
```tsx
export default function Home() {
  return <main className="p-6 text-lg font-semibold">Schedule Management</main>;
}
```

- [ ] **Step 4: Write the smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install and run the smoke test**

Run: `cd /home/coder/projects/Skilesconnect/schedulemanagement && npm install && npm test`
Expected: install completes; Vitest reports `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 14 + Prisma + Tailwind + Vitest"
```

---

### Task 2: Prisma schema, migration, and client

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`, `tests/db.test.ts`

**Interfaces:**
- Produces: Prisma models `Project`, `ScheduleImport`, `Activity`, `Relationship`, `Resource`, `Assignment`, `Calendar`; `prisma` client export from `@/lib/db`.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Project {
  id                  String   @id @default(cuid())
  name                String
  client              String?
  sector              String?
  buildingType        String?
  sizeSqFt            Int?
  contractValue       Decimal? @db.Decimal(14, 2)
  region              String?
  deliveryMethod      String?
  status              String   @default("active")
  externalProjectKey  String?
  externalProjectGuid String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  imports             ScheduleImport[]
}

model ScheduleImport {
  id                     String    @id @default(cuid())
  projectId              String
  project                Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceFormat           String
  fileName               String
  fileHash               String
  importedAt             DateTime  @default(now())
  importedBy             String?
  projectTitleFromFile   String?
  statusDate             DateTime?
  isBaseline             Boolean   @default(false)
  projectStart           DateTime?
  projectFinish          DateTime?
  minutesPerDay          Int?
  minutesPerWeek         Int?
  daysPerMonth           Int?
  rawProjectProps        Json?
  importFieldDefinitions Json?
  activityCount          Int       @default(0)
  relationshipCount      Int       @default(0)
  resourceCount          Int       @default(0)
  warnings               Json?
  notes                  String?
  activities             Activity[]
  relationships          Relationship[]
  resources              Resource[]
  assignments            Assignment[]
  calendars              Calendar[]

  @@index([projectId])
}

model Activity {
  id                       String    @id @default(cuid())
  scheduleImportId         String
  scheduleImport           ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  externalUid              Int
  externalGuid             String?
  externalId               Int?
  wbsCode                  String?
  outlineNumber            String?
  outlineLevel             Int       @default(0)
  parentExternalUid        Int?
  name                     String
  canonicalActivityKey     String
  type                     String
  rawType                  String?
  isMilestone              Boolean   @default(false)
  isSummary                Boolean   @default(false)
  isProjectSummary         Boolean   @default(false)
  isCritical               Boolean   @default(false)
  isActive                 Boolean   @default(true)
  plannedStart             DateTime?
  plannedFinish            DateTime?
  earlyStart               DateTime?
  earlyFinish              DateTime?
  lateStart                DateTime?
  lateFinish               DateTime?
  actualStart              DateTime?
  actualFinish             DateTime?
  baselineStart            DateTime?
  baselineFinish           DateTime?
  baselineDurationMinutes  Float?
  durationMinutes          Float?
  durationDays             Float?
  remainingDurationMinutes Float?
  actualDurationMinutes    Float?
  percentComplete          Int?
  percentWorkComplete      Int?
  totalSlackMinutes        Float?
  freeSlackMinutes         Float?
  constraintType           Int?
  constraintDate           DateTime?
  deadline                 DateTime?
  calendarExternalUid      Int?
  customFields             Json?
  rawBaselines             Json?

  @@index([scheduleImportId])
  @@index([scheduleImportId, externalUid])
  @@index([scheduleImportId, wbsCode])
  @@index([scheduleImportId, plannedStart])
}

model Relationship {
  id                     String   @id @default(cuid())
  scheduleImportId       String
  scheduleImport         ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  predecessorExternalUid Int
  successorExternalUid   Int
  type                   String
  rawType                String?
  lagMinutes             Float?
  rawLagFormat           String?
  crossProject           Boolean  @default(false)

  @@index([scheduleImportId])
}

model Resource {
  id               String   @id @default(cuid())
  scheduleImportId String
  scheduleImport   ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  externalUid      Int
  name             String?
  type             String?
  group            String?
  customFields     Json?

  @@index([scheduleImportId])
}

model Assignment {
  id                  String   @id @default(cuid())
  scheduleImportId    String
  scheduleImport      ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  activityExternalUid Int
  resourceExternalUid Int
  units               Float?
  workMinutes         Float?

  @@index([scheduleImportId])
}

model Calendar {
  id               String   @id @default(cuid())
  scheduleImportId String
  scheduleImport   ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  externalUid      Int
  name             String?
  raw              Json?

  @@index([scheduleImportId])
}
```

- [ ] **Step 2: Write the Prisma client singleton**

`lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Generate client and run the migration**

Run: `cd /home/coder/projects/Skilesconnect/schedulemanagement && npx prisma migrate dev --name init`
Expected: a migration is created under `prisma/migrations/`, applied to the `DATABASE_URL` database, and the client generates. (Requires a reachable Railway `DATABASE_URL` in `.env`.)

- [ ] **Step 4: Write a DB connectivity test**

`tests/db.test.ts`:
```ts
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
```

- [ ] **Step 5: Run the test**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (or skipped if `DATABASE_URL` is unset — then run after configuring `.env`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Prisma schema, migration, and client for the canonical schedule model"
```

---

### Task 3: Duration & unit conversion utilities

**Files:**
- Create: `lib/msp/duration.ts`, `tests/msp/duration.test.ts`

**Interfaces:**
- Produces:
  - `parseIsoDurationToMinutes(value: string | null | undefined): number | null`
  - `tenthsOfMinuteToMinutes(value: string | number | null | undefined): number | null`
  - `minutesToDays(minutes: number | null, minutesPerDay: number): number | null`

- [ ] **Step 1: Write the failing test**

`tests/msp/duration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseIsoDurationToMinutes, tenthsOfMinuteToMinutes, minutesToDays } from "@/lib/msp/duration";

describe("parseIsoDurationToMinutes", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIsoDurationToMinutes("PT8H0M0S")).toBe(480);
    expect(parseIsoDurationToMinutes("PT0H30M0S")).toBe(30);
    expect(parseIsoDurationToMinutes("PT1H30M0S")).toBe(90);
  });
  it("returns null for empty/invalid", () => {
    expect(parseIsoDurationToMinutes(null)).toBeNull();
    expect(parseIsoDurationToMinutes("")).toBeNull();
    expect(parseIsoDurationToMinutes("garbage")).toBeNull();
  });
});

describe("tenthsOfMinuteToMinutes", () => {
  it("divides tenths of a minute", () => {
    expect(tenthsOfMinuteToMinutes("4800")).toBe(480);
    expect(tenthsOfMinuteToMinutes(0)).toBe(0);
  });
  it("returns null for empty", () => {
    expect(tenthsOfMinuteToMinutes(null)).toBeNull();
    expect(tenthsOfMinuteToMinutes("")).toBeNull();
  });
});

describe("minutesToDays", () => {
  it("converts using minutesPerDay", () => {
    expect(minutesToDays(480, 480)).toBe(1);
    expect(minutesToDays(960, 480)).toBe(2);
  });
  it("returns null when minutes is null", () => {
    expect(minutesToDays(null, 480)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/msp/duration.test.ts`
Expected: FAIL — cannot resolve `@/lib/msp/duration`.

- [ ] **Step 3: Write the implementation**

`lib/msp/duration.ts`:
```ts
/** Parse an ISO-8601 duration like "PT8H0M0S" to minutes. */
export function parseIsoDurationToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  return hours * 60 + minutes + seconds / 60;
}

/** MSPDI slack/lag numeric duration fields are integer tenths of a minute. */
export function tenthsOfMinuteToMinutes(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n / 10;
}

/** Convert working minutes to working days using the project's MinutesPerDay. */
export function minutesToDays(minutes: number | null, minutesPerDay: number): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/msp/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: MSPDI duration and unit conversion utilities"
```

---

### Task 4: Relationship type mapping

**Files:**
- Create: `lib/msp/relationshipType.ts`, `tests/msp/relationshipType.test.ts`

**Interfaces:**
- Produces: `mapRelationshipType(rawType: string | number | null | undefined): RelationshipType` where `RelationshipType = "FS" | "SS" | "FF" | "SF"` (the type is declared in `lib/msp/types.ts`, Task 6; for this task declare it locally and re-export — Task 6 imports it from here is NOT required, both import from `types.ts`). To avoid a forward dependency, define the union inline here and Task 6 will import `RelationshipType` from `./types`; keep the string values identical: `"FS" | "SS" | "FF" | "SF"`.

- [ ] **Step 1: Write the failing test**

`tests/msp/relationshipType.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapRelationshipType } from "@/lib/msp/relationshipType";

describe("mapRelationshipType", () => {
  it("maps MSPDI codes", () => {
    expect(mapRelationshipType("0")).toBe("FF");
    expect(mapRelationshipType("1")).toBe("FS");
    expect(mapRelationshipType("2")).toBe("SF");
    expect(mapRelationshipType("3")).toBe("SS");
    expect(mapRelationshipType(1)).toBe("FS");
  });
  it("defaults unknown/missing to FS", () => {
    expect(mapRelationshipType(null)).toBe("FS");
    expect(mapRelationshipType("9")).toBe("FS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/msp/relationshipType.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

`lib/msp/relationshipType.ts`:
```ts
export type RelationshipType = "FS" | "SS" | "FF" | "SF";

const MAP: Record<string, RelationshipType> = {
  "0": "FF",
  "1": "FS",
  "2": "SF",
  "3": "SS",
};

/** Map an MSPDI PredecessorLink Type code to a canonical relationship type. */
export function mapRelationshipType(rawType: string | number | null | undefined): RelationshipType {
  const key = String(rawType ?? "1");
  return MAP[key] ?? "FS";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/msp/relationshipType.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: MSPDI relationship-type mapping"
```

---

### Task 5: Hierarchy parent derivation & canonical key

**Files:**
- Create: `lib/msp/hierarchy.ts`, `lib/msp/canonicalKey.ts`, `tests/msp/hierarchy.test.ts`

**Interfaces:**
- Produces:
  - `deriveParents<T extends { externalUid: number; outlineLevel: number }>(nodes: T[]): Map<number, number | null>`
  - `canonicalActivityKey(wbsCode: string | null, name: string): string`

- [ ] **Step 1: Write the failing test**

`tests/msp/hierarchy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deriveParents } from "@/lib/msp/hierarchy";
import { canonicalActivityKey } from "@/lib/msp/canonicalKey";

describe("deriveParents", () => {
  it("derives parents from outline levels in document order", () => {
    const nodes = [
      { externalUid: 0, outlineLevel: 0 }, // project summary
      { externalUid: 1, outlineLevel: 1 }, // area  -> parent 0
      { externalUid: 2, outlineLevel: 2 }, // phase -> parent 1
      { externalUid: 3, outlineLevel: 3 }, // task  -> parent 2
      { externalUid: 4, outlineLevel: 3 }, // task  -> parent 2
      { externalUid: 5, outlineLevel: 2 }, // phase -> parent 1
    ];
    const parents = deriveParents(nodes);
    expect(parents.get(0)).toBeNull();
    expect(parents.get(1)).toBe(0);
    expect(parents.get(2)).toBe(1);
    expect(parents.get(3)).toBe(2);
    expect(parents.get(4)).toBe(2);
    expect(parents.get(5)).toBe(1);
  });
});

describe("canonicalActivityKey", () => {
  it("normalizes whitespace and case, keyed by wbs", () => {
    expect(canonicalActivityKey("1.2.3", "Electrical  Rough-In")).toBe("1.2.3|electrical rough-in");
    expect(canonicalActivityKey(null, "Foo")).toBe("|foo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/msp/hierarchy.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`lib/msp/hierarchy.ts`:
```ts
export interface OutlineNode {
  externalUid: number;
  outlineLevel: number;
}

/**
 * Derive each node's parent UID from outline levels in document order.
 * Parent = nearest preceding node with a strictly smaller outline level.
 */
export function deriveParents<T extends OutlineNode>(nodes: T[]): Map<number, number | null> {
  const result = new Map<number, number | null>();
  const stack: T[] = [];
  for (const node of nodes) {
    while (stack.length && stack[stack.length - 1].outlineLevel >= node.outlineLevel) stack.pop();
    result.set(node.externalUid, stack.length ? stack[stack.length - 1].externalUid : null);
    stack.push(node);
  }
  return result;
}
```

`lib/msp/canonicalKey.ts`:
```ts
/** Stable key for threading the same activity across import versions. */
export function canonicalActivityKey(wbsCode: string | null, name: string): string {
  const wbs = (wbsCode ?? "").trim();
  const normName = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${wbs}|${normName}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/msp/hierarchy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: outline-hierarchy parent derivation and canonical activity key"
```

---

### Task 6: Canonical types & the MSP XML parser

**Files:**
- Create: `lib/msp/types.ts`, `lib/msp/parseMspXml.ts`, `tests/fixtures/minimal.xml`, `tests/msp/parseMspXml.test.ts`

**Interfaces:**
- Consumes: `parseIsoDurationToMinutes`, `tenthsOfMinuteToMinutes`, `minutesToDays` (Task 3); `mapRelationshipType` + `RelationshipType` (Task 4); `deriveParents` (Task 5); `canonicalActivityKey` (Task 5).
- Produces: `parseMspXml(xml: string): ParsedSchedule` and all `Parsed*` types.

- [ ] **Step 1: Write the canonical types**

`lib/msp/types.ts`:
```ts
import type { RelationshipType } from "./relationshipType";
export type { RelationshipType };

export type CanonicalActivityType = "task" | "milestone" | "summary" | "project_summary";

export interface ParsedProjectHeader {
  titleFromFile: string;
  externalProjectGuid: string | null;
  statusDate: string | null;
  projectStart: string | null;
  projectFinish: string | null;
  minutesPerDay: number;
  minutesPerWeek: number | null;
  daysPerMonth: number | null;
  defaultCalendarUid: number | null;
  rawProps: Record<string, string>;
}

export interface ParsedFieldDefinition {
  fieldId: string;
  fieldName: string;
  alias: string;
}

export interface ParsedActivity {
  externalUid: number;
  externalGuid: string | null;
  externalId: number | null;
  name: string;
  wbsCode: string | null;
  outlineNumber: string | null;
  outlineLevel: number;
  parentExternalUid: number | null;
  type: CanonicalActivityType;
  rawType: string | null;
  isMilestone: boolean;
  isSummary: boolean;
  isProjectSummary: boolean;
  isCritical: boolean;
  isActive: boolean;
  plannedStart: string | null;
  plannedFinish: string | null;
  earlyStart: string | null;
  earlyFinish: string | null;
  lateStart: string | null;
  lateFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  baselineDurationMinutes: number | null;
  durationMinutes: number | null;
  durationDays: number | null;
  remainingDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  percentComplete: number | null;
  percentWorkComplete: number | null;
  totalSlackMinutes: number | null;
  freeSlackMinutes: number | null;
  constraintType: number | null;
  constraintDate: string | null;
  deadline: string | null;
  calendarExternalUid: number | null;
  customFields: Record<string, string>;
  rawBaselines: unknown[];
  canonicalActivityKey: string;
}

export interface ParsedRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: RelationshipType;
  rawType: string;
  lagMinutes: number | null;
  rawLagFormat: string | null;
  crossProject: boolean;
}

export interface ParsedResource {
  externalUid: number;
  name: string | null;
  type: string | null;
  group: string | null;
  customFields: Record<string, string>;
}

export interface ParsedAssignment {
  activityExternalUid: number;
  resourceExternalUid: number;
  units: number | null;
  workMinutes: number | null;
}

export interface ParsedCalendar {
  externalUid: number;
  name: string | null;
  raw: unknown;
}

export interface ParsedSchedule {
  header: ParsedProjectHeader;
  fieldDefinitions: ParsedFieldDefinition[];
  activities: ParsedActivity[];
  relationships: ParsedRelationship[];
  resources: ParsedResource[];
  assignments: ParsedAssignment[];
  calendars: ParsedCalendar[];
  warnings: string[];
  counts: { activities: number; milestones: number; relationships: number; resources: number };
}
```

- [ ] **Step 2: Write the fixture**

`tests/fixtures/minimal.xml`:
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Minimal Test Schedule</Title>
  <GUID>TEST-GUID-1</GUID>
  <StartDate>2025-06-03T08:00:00</StartDate>
  <FinishDate>2025-06-10T17:00:00</FinishDate>
  <StatusDate>2025-06-05T17:00:00</StatusDate>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <CalendarUID>1</CalendarUID>
  <ExtendedAttributes>
    <ExtendedAttribute>
      <FieldID>188743731</FieldID>
      <FieldName>Text1</FieldName>
      <Alias>Phoenix ID</Alias>
    </ExtendedAttribute>
  </ExtendedAttributes>
  <Tasks>
    <Task>
      <UID>0</UID><ID>0</ID><Name>Minimal Test Schedule</Name>
      <WBS>0</WBS><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel>
      <Milestone>0</Milestone><Summary>1</Summary><IsNull>0</IsNull>
    </Task>
    <Task>
      <UID>1</UID><ID>1</ID><Name>Mobilize</Name>
      <WBS>1</WBS><OutlineNumber>1</OutlineNumber><OutlineLevel>1</OutlineLevel>
      <Type>1</Type><Milestone>0</Milestone><Summary>0</Summary><Critical>1</Critical><IsNull>0</IsNull>
      <Start>2025-06-03T08:00:00</Start><Finish>2025-06-03T17:00:00</Finish>
      <Duration>PT8H0M0S</Duration><PercentComplete>100</PercentComplete>
      <ActualStart>2025-06-03T08:00:00</ActualStart><ActualFinish>2025-06-03T17:00:00</ActualFinish>
      <TotalSlack>0</TotalSlack><CalendarUID>1</CalendarUID>
      <ExtendedAttribute><FieldID>188743731</FieldID><Value>PX-1</Value></ExtendedAttribute>
      <Baseline><Number>0</Number><Start>2025-06-03T08:00:00</Start><Finish>2025-06-03T17:00:00</Finish><Duration>PT8H0M0S</Duration></Baseline>
    </Task>
    <Task>
      <UID>2</UID><ID>2</ID><Name>Electrical Rough-In</Name>
      <WBS>2</WBS><OutlineNumber>2</OutlineNumber><OutlineLevel>1</OutlineLevel>
      <Type>1</Type><Milestone>0</Milestone><Summary>0</Summary><IsNull>0</IsNull>
      <Start>2025-06-04T08:00:00</Start><Finish>2025-06-06T17:00:00</Finish>
      <Duration>PT24H0M0S</Duration><PercentComplete>0</PercentComplete><TotalSlack>4800</TotalSlack>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task>
      <UID>3</UID><ID>3</ID><Name>Project Complete</Name>
      <WBS>3</WBS><OutlineNumber>3</OutlineNumber><OutlineLevel>1</OutlineLevel>
      <Type>1</Type><Milestone>1</Milestone><Summary>0</Summary><IsNull>0</IsNull>
      <Start>2025-06-06T17:00:00</Start><Finish>2025-06-06T17:00:00</Finish>
      <Duration>PT0H0M0S</Duration>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task>
      <UID>99</UID><ID>99</ID><Name>Null Placeholder</Name>
      <OutlineLevel>1</OutlineLevel><IsNull>1</IsNull>
    </Task>
  </Tasks>
  <Resources><Resource><UID>0</UID><Name></Name></Resource></Resources>
  <Calendars><Calendar><UID>1</UID><Name>Standard</Name></Calendar></Calendars>
</Project>
```

- [ ] **Step 3: Write the failing test**

`tests/msp/parseMspXml.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");

describe("parseMspXml (minimal fixture)", () => {
  const result = parseMspXml(xml);

  it("reads the header", () => {
    expect(result.header.titleFromFile).toBe("Minimal Test Schedule");
    expect(result.header.statusDate).toBe("2025-06-05T17:00:00");
    expect(result.header.minutesPerDay).toBe(480);
  });

  it("maps the custom field alias", () => {
    expect(result.fieldDefinitions[0].alias).toBe("Phoenix ID");
  });

  it("skips IsNull tasks and counts the rest", () => {
    expect(result.activities.find((a) => a.externalUid === 99)).toBeUndefined();
    expect(result.counts.activities).toBe(4);
    expect(result.counts.milestones).toBe(1);
  });

  it("classifies types", () => {
    expect(result.activities.find((a) => a.externalUid === 0)?.type).toBe("project_summary");
    expect(result.activities.find((a) => a.externalUid === 3)?.type).toBe("milestone");
    expect(result.activities.find((a) => a.externalUid === 2)?.type).toBe("task");
  });

  it("normalizes durations and slack", () => {
    const elec = result.activities.find((a) => a.externalUid === 2)!;
    expect(elec.durationMinutes).toBe(1440);
    expect(elec.durationDays).toBe(3);
    expect(elec.totalSlackMinutes).toBe(480);
  });

  it("captures custom field values by alias", () => {
    const mob = result.activities.find((a) => a.externalUid === 1)!;
    expect(mob.customFields["Phoenix ID"]).toBe("PX-1");
    expect(mob.baselineStart).toBe("2025-06-03T08:00:00");
  });

  it("builds relationships with mapped type and lag", () => {
    expect(result.counts.relationships).toBe(2);
    const toMilestone = result.relationships.find((r) => r.successorExternalUid === 3)!;
    expect(toMilestone.type).toBe("FS");
    expect(toMilestone.lagMinutes).toBe(480);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- tests/msp/parseMspXml.test.ts`
Expected: FAIL — `parseMspXml` not found.

- [ ] **Step 5: Write the parser**

`lib/msp/parseMspXml.ts`:
```ts
import { XMLParser } from "fast-xml-parser";
import type {
  ParsedSchedule, ParsedActivity, ParsedRelationship, ParsedFieldDefinition,
  ParsedResource, ParsedAssignment, ParsedCalendar, ParsedProjectHeader, CanonicalActivityType,
} from "./types";
import { parseIsoDurationToMinutes, tenthsOfMinuteToMinutes, minutesToDays } from "./duration";
import { mapRelationshipType } from "./relationshipType";
import { deriveParents } from "./hierarchy";
import { canonicalActivityKey } from "./canonicalKey";

type Any = Record<string, unknown>;

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length ? s : null;
}
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function bool(v: unknown): boolean {
  return String(v) === "1";
}

export function parseMspXml(xml: string): ParsedSchedule {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml) as Any;
  const project = doc.Project as Any | undefined;
  if (!project) throw new Error("Not a Microsoft Project XML file (missing <Project> root).");
  const warnings: string[] = [];

  const fieldDefinitions: ParsedFieldDefinition[] = toArray((project.ExtendedAttributes as Any)?.ExtendedAttribute as Any).map((ea: Any) => ({
    fieldId: String(ea.FieldID ?? ""),
    fieldName: String(ea.FieldName ?? ""),
    alias: String(ea.Alias ?? ea.FieldName ?? ""),
  }));
  const aliasByFieldId = new Map(fieldDefinitions.map((f) => [f.fieldId, f.alias]));

  const rawProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(project)) {
    if (typeof v === "string" || typeof v === "number") rawProps[k] = String(v);
  }

  const header: ParsedProjectHeader = {
    titleFromFile: str(project.Title) ?? str(project.Name) ?? "Untitled",
    externalProjectGuid: str(project.GUID),
    statusDate: str(project.StatusDate),
    projectStart: str(project.StartDate),
    projectFinish: str(project.FinishDate),
    minutesPerDay: num(project.MinutesPerDay) ?? 480,
    minutesPerWeek: num(project.MinutesPerWeek),
    daysPerMonth: num(project.DaysPerMonth),
    defaultCalendarUid: num(project.CalendarUID),
    rawProps,
  };
  const minutesPerDay = header.minutesPerDay;

  const rawTasks = toArray((project.Tasks as Any)?.Task as Any).filter((t: Any) => !bool(t.IsNull));
  const outlineNodes = rawTasks.map((t: Any) => ({ externalUid: num(t.UID) ?? -1, outlineLevel: num(t.OutlineLevel) ?? 0 }));
  const parentMap = deriveParents(outlineNodes);

  const activities: ParsedActivity[] = [];
  const relationships: ParsedRelationship[] = [];
  let milestoneCount = 0;

  for (const t of rawTasks) {
    const uid = num(t.UID);
    if (uid === null) { warnings.push("Skipped a task with no UID."); continue; }

    const isMilestone = bool(t.Milestone);
    const isSummary = bool(t.Summary);
    const outlineLevel = num(t.OutlineLevel) ?? 0;
    const isProjectSummary = outlineLevel === 0;
    let type: CanonicalActivityType = "task";
    if (isProjectSummary) type = "project_summary";
    else if (isSummary) type = "summary";
    else if (isMilestone) type = "milestone";
    if (isMilestone) milestoneCount++;

    const customFields: Record<string, string> = {};
    for (const ea of toArray(t.ExtendedAttribute as Any)) {
      const alias = aliasByFieldId.get(String((ea as Any).FieldID)) ?? String((ea as Any).FieldID);
      const val = str((ea as Any).Value);
      if (val !== null) customFields[alias] = val;
    }

    const baselines = toArray(t.Baseline as Any);
    const baseline0 = baselines.find((b: Any) => String(b.Number) === "0") as Any | undefined;
    const durationMinutes = parseIsoDurationToMinutes(str(t.Duration));
    const name = str(t.Name) ?? "(unnamed)";
    const wbsCode = str(t.WBS);

    activities.push({
      externalUid: uid,
      externalGuid: str(t.GUID),
      externalId: num(t.ID),
      name,
      wbsCode,
      outlineNumber: str(t.OutlineNumber),
      outlineLevel,
      parentExternalUid: parentMap.get(uid) ?? null,
      type,
      rawType: str(t.Type),
      isMilestone,
      isSummary,
      isProjectSummary,
      isCritical: bool(t.Critical),
      isActive: t.Active === undefined ? true : bool(t.Active),
      plannedStart: str(t.Start),
      plannedFinish: str(t.Finish),
      earlyStart: str(t.EarlyStart),
      earlyFinish: str(t.EarlyFinish),
      lateStart: str(t.LateStart),
      lateFinish: str(t.LateFinish),
      actualStart: str(t.ActualStart),
      actualFinish: str(t.ActualFinish),
      baselineStart: baseline0 ? str(baseline0.Start) : null,
      baselineFinish: baseline0 ? str(baseline0.Finish) : null,
      baselineDurationMinutes: baseline0 ? parseIsoDurationToMinutes(str(baseline0.Duration)) : null,
      durationMinutes,
      durationDays: minutesToDays(durationMinutes, minutesPerDay),
      remainingDurationMinutes: parseIsoDurationToMinutes(str(t.RemainingDuration)),
      actualDurationMinutes: parseIsoDurationToMinutes(str(t.ActualDuration)),
      percentComplete: num(t.PercentComplete),
      percentWorkComplete: num(t.PercentWorkComplete),
      totalSlackMinutes: tenthsOfMinuteToMinutes(t.TotalSlack as string),
      freeSlackMinutes: tenthsOfMinuteToMinutes(t.FreeSlack as string),
      constraintType: num(t.ConstraintType),
      constraintDate: str(t.ConstraintDate),
      deadline: str(t.Deadline),
      calendarExternalUid: num(t.CalendarUID),
      customFields,
      rawBaselines: baselines,
      canonicalActivityKey: canonicalActivityKey(wbsCode, name),
    });

    for (const link of toArray(t.PredecessorLink as Any)) {
      const predUid = num((link as Any).PredecessorUID);
      if (predUid === null) continue;
      relationships.push({
        predecessorExternalUid: predUid,
        successorExternalUid: uid,
        type: mapRelationshipType(str((link as Any).Type)),
        rawType: str((link as Any).Type) ?? "",
        lagMinutes: tenthsOfMinuteToMinutes((link as Any).LinkLag as string),
        rawLagFormat: str((link as Any).LagFormat),
        crossProject: bool((link as Any).CrossProject),
      });
    }
  }

  const resources: ParsedResource[] = toArray((project.Resources as Any)?.Resource as Any)
    .filter((r: Any) => num(r.UID) !== null)
    .map((r: Any) => {
      const customFields: Record<string, string> = {};
      for (const ea of toArray(r.ExtendedAttribute as Any)) {
        const alias = aliasByFieldId.get(String((ea as Any).FieldID)) ?? String((ea as Any).FieldID);
        const val = str((ea as Any).Value);
        if (val !== null) customFields[alias] = val;
      }
      return { externalUid: num(r.UID) as number, name: str(r.Name), type: str(r.Type), group: str(r.Group), customFields };
    });

  const assignments: ParsedAssignment[] = toArray((project.Assignments as Any)?.Assignment as Any)
    .filter((a: Any) => num(a.TaskUID) !== null && num(a.ResourceUID) !== null)
    .map((a: Any) => ({
      activityExternalUid: num(a.TaskUID) as number,
      resourceExternalUid: num(a.ResourceUID) as number,
      units: num(a.Units),
      workMinutes: parseIsoDurationToMinutes(str(a.Work)),
    }));

  const calendars: ParsedCalendar[] = toArray((project.Calendars as Any)?.Calendar as Any)
    .filter((c: Any) => num(c.UID) !== null)
    .map((c: Any) => ({ externalUid: num(c.UID) as number, name: str(c.Name), raw: c }));

  return {
    header,
    fieldDefinitions,
    activities,
    relationships,
    resources,
    assignments,
    calendars,
    warnings,
    counts: {
      activities: activities.length,
      milestones: milestoneCount,
      relationships: relationships.length,
      resources: resources.length,
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/msp/parseMspXml.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 7: Add a real-file integration test**

Copy one real export into the fixtures folder first:
Run: `cp "/home/coder/projects/Skilesconnect/schedulemanagement/BSW Regional Cath IR Schedule 1.30.26 Baseline.xml" /home/coder/projects/Skilesconnect/schedulemanagement/tests/fixtures/cath-ir-baseline.xml`

Append to `tests/msp/parseMspXml.test.ts`:
```ts
import { existsSync } from "node:fs";

const realPath = resolve(__dirname, "../fixtures/cath-ir-baseline.xml");

describe.runIf(existsSync(realPath))("parseMspXml (real Cath IR export)", () => {
  const real = parseMspXml(readFileSync(realPath, "utf8"));
  it("parses the expected real-world shape", () => {
    expect(real.header.statusDate).toBe("2026-01-30T17:00:00");
    expect(real.activities.length).toBeGreaterThan(250);
    expect(real.relationships.length).toBeGreaterThan(100);
    expect(real.fieldDefinitions.some((f) => f.alias === "Phoenix ID")).toBe(true);
    expect(real.activities.every((a) => a.canonicalActivityKey.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 8: Run the full MSP suite**

Run: `npm test -- tests/msp/parseMspXml.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: MSPDI parser producing the canonical ParsedSchedule"
```

---

### Task 7: Transactional import persistence

**Files:**
- Create: `lib/import/commitImport.ts`, `tests/import/commitImport.test.ts`

**Interfaces:**
- Consumes: `parseMspXml` (Task 6); `prisma` (Task 2).
- Produces:
  - `toDbDate(s: string | null): Date | null`
  - `previewImport(xml: string): { parsed: ParsedSchedule; fileHash: string; suggestedIsBaseline: boolean }`
  - `commitImport(opts: { projectId: string; fileName: string; xml: string; statusDateOverride?: string | null; importedBy?: string | null; isBaseline?: boolean }): Promise<{ id: string }>`

- [ ] **Step 1: Write the failing integration test**

`tests/import/commitImport.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport, previewImport, toDbDate } from "@/lib/import/commitImport";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe("toDbDate", () => {
  it("treats naive MSPDI datetimes as UTC wall-clock", () => {
    expect(toDbDate("2025-06-03T08:00:00")?.toISOString()).toBe("2025-06-03T08:00:00.000Z");
    expect(toDbDate(null)).toBeNull();
  });
});

describe("previewImport", () => {
  it("returns counts without touching the DB", () => {
    const p = previewImport(xml);
    expect(p.parsed.counts.activities).toBe(4);
    expect(p.fileHash).toHaveLength(64);
  });
});

describe.runIf(hasDb)("commitImport", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("writes an immutable snapshot with all child rows", async () => {
    const project = await prisma.project.create({ data: { name: "Commit Test" } });
    projectId = project.id;
    const { id } = await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    const imp = await prisma.scheduleImport.findUnique({
      where: { id },
      include: { activities: true, relationships: true },
    });
    expect(imp?.activityCount).toBe(4);
    expect(imp?.activities.length).toBe(4);
    expect(imp?.relationships.length).toBe(2);
    expect(imp?.statusDate?.toISOString()).toBe("2025-06-05T17:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/import/commitImport.test.ts`
Expected: FAIL — module not found (DB block skips if no `DATABASE_URL`).

- [ ] **Step 3: Write the implementation**

`lib/import/commitImport.ts`:
```ts
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import type { ParsedSchedule } from "@/lib/msp/types";

/** MSPDI datetimes are naive local; store wall-clock deterministically as UTC. */
export function toDbDate(s: string | null): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d\d:\d\d$/.test(s);
  return new Date(hasTz ? s : `${s}Z`);
}

export function previewImport(xml: string): { parsed: ParsedSchedule; fileHash: string; suggestedIsBaseline: boolean } {
  const parsed = parseMspXml(xml);
  const fileHash = crypto.createHash("sha256").update(xml).digest("hex");
  const hasAnyBaseline = parsed.activities.some((a) => a.baselineStart || a.baselineFinish);
  return { parsed, fileHash, suggestedIsBaseline: !hasAnyBaseline };
}

export interface CommitOptions {
  projectId: string;
  fileName: string;
  xml: string;
  statusDateOverride?: string | null;
  importedBy?: string | null;
  isBaseline?: boolean;
}

export async function commitImport(opts: CommitOptions): Promise<{ id: string }> {
  const { parsed, fileHash, suggestedIsBaseline } = previewImport(opts.xml);
  const statusDate = opts.statusDateOverride ?? parsed.header.statusDate;
  const isBaseline = opts.isBaseline ?? suggestedIsBaseline;

  const imp = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleImport.create({
      data: {
        projectId: opts.projectId,
        sourceFormat: "msproject_xml",
        fileName: opts.fileName,
        fileHash,
        importedBy: opts.importedBy ?? null,
        projectTitleFromFile: parsed.header.titleFromFile,
        statusDate: toDbDate(statusDate),
        isBaseline,
        projectStart: toDbDate(parsed.header.projectStart),
        projectFinish: toDbDate(parsed.header.projectFinish),
        minutesPerDay: parsed.header.minutesPerDay,
        minutesPerWeek: parsed.header.minutesPerWeek,
        daysPerMonth: parsed.header.daysPerMonth,
        rawProjectProps: parsed.header.rawProps,
        importFieldDefinitions: parsed.fieldDefinitions,
        activityCount: parsed.counts.activities,
        relationshipCount: parsed.counts.relationships,
        resourceCount: parsed.counts.resources,
        warnings: parsed.warnings,
      },
    });

    if (parsed.activities.length) {
      await tx.activity.createMany({
        data: parsed.activities.map((a) => ({
          scheduleImportId: created.id,
          externalUid: a.externalUid,
          externalGuid: a.externalGuid,
          externalId: a.externalId,
          wbsCode: a.wbsCode,
          outlineNumber: a.outlineNumber,
          outlineLevel: a.outlineLevel,
          parentExternalUid: a.parentExternalUid,
          name: a.name,
          canonicalActivityKey: a.canonicalActivityKey,
          type: a.type,
          rawType: a.rawType,
          isMilestone: a.isMilestone,
          isSummary: a.isSummary,
          isProjectSummary: a.isProjectSummary,
          isCritical: a.isCritical,
          isActive: a.isActive,
          plannedStart: toDbDate(a.plannedStart),
          plannedFinish: toDbDate(a.plannedFinish),
          earlyStart: toDbDate(a.earlyStart),
          earlyFinish: toDbDate(a.earlyFinish),
          lateStart: toDbDate(a.lateStart),
          lateFinish: toDbDate(a.lateFinish),
          actualStart: toDbDate(a.actualStart),
          actualFinish: toDbDate(a.actualFinish),
          baselineStart: toDbDate(a.baselineStart),
          baselineFinish: toDbDate(a.baselineFinish),
          baselineDurationMinutes: a.baselineDurationMinutes,
          durationMinutes: a.durationMinutes,
          durationDays: a.durationDays,
          remainingDurationMinutes: a.remainingDurationMinutes,
          actualDurationMinutes: a.actualDurationMinutes,
          percentComplete: a.percentComplete,
          percentWorkComplete: a.percentWorkComplete,
          totalSlackMinutes: a.totalSlackMinutes,
          freeSlackMinutes: a.freeSlackMinutes,
          constraintType: a.constraintType,
          constraintDate: toDbDate(a.constraintDate),
          deadline: toDbDate(a.deadline),
          calendarExternalUid: a.calendarExternalUid,
          customFields: a.customFields,
          rawBaselines: a.rawBaselines as object[],
        })),
      });
    }

    if (parsed.relationships.length) {
      await tx.relationship.createMany({
        data: parsed.relationships.map((r) => ({
          scheduleImportId: created.id,
          predecessorExternalUid: r.predecessorExternalUid,
          successorExternalUid: r.successorExternalUid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        })),
      });
    }

    if (parsed.resources.length) {
      await tx.resource.createMany({
        data: parsed.resources.map((r) => ({
          scheduleImportId: created.id,
          externalUid: r.externalUid,
          name: r.name,
          type: r.type,
          group: r.group,
          customFields: r.customFields,
        })),
      });
    }

    if (parsed.assignments.length) {
      await tx.assignment.createMany({
        data: parsed.assignments.map((a) => ({
          scheduleImportId: created.id,
          activityExternalUid: a.activityExternalUid,
          resourceExternalUid: a.resourceExternalUid,
          units: a.units,
          workMinutes: a.workMinutes,
        })),
      });
    }

    if (parsed.calendars.length) {
      await tx.calendar.createMany({
        data: parsed.calendars.map((c) => ({
          scheduleImportId: created.id,
          externalUid: c.externalUid,
          name: c.name,
          raw: c.raw as object,
        })),
      });
    }

    return created;
  });

  return { id: imp.id };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/import/commitImport.test.ts`
Expected: PASS (`toDbDate` and `previewImport` always; `commitImport` when `DATABASE_URL` is set).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: transactional commitImport + previewImport"
```

---

### Task 8: Shared-password auth (lib + login + middleware)

**Files:**
- Create: `lib/auth.ts`, `app/api/login/route.ts`, `app/login/page.tsx`, `middleware.ts`, `tests/auth.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE: string` (value `"sms_session"`)
  - `checkPassword(input: string): boolean`
  - `sessionToken(): string`
  - `isAuthed(cookieValue: string | undefined): boolean`

- [ ] **Step 1: Write the failing test**

`tests/auth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkPassword, isAuthed, SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_SESSION_TOKEN = "token-abc";
});

describe("auth", () => {
  it("exposes the cookie name", () => {
    expect(SESSION_COOKIE).toBe("sms_session");
  });
  it("checks the shared password", () => {
    expect(checkPassword("secret123")).toBe(true);
    expect(checkPassword("nope")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("validates the session cookie against the token", () => {
    expect(isAuthed("token-abc")).toBe(true);
    expect(isAuthed("wrong")).toBe(false);
    expect(isAuthed(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth.test.ts`
Expected: FAIL — `@/lib/auth` not found.

- [ ] **Step 3: Write the auth lib**

`lib/auth.ts`:
```ts
export const SESSION_COOKIE = "sms_session";

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function sessionToken(): string {
  return process.env.APP_SESSION_TOKEN ?? "";
}

export function isAuthed(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the login route, page, and middleware**

`app/api/login/route.ts`:
```ts
import { NextResponse } from "next/server";
import { checkPassword, sessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

`app/login/page.tsx`:
```tsx
export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-4 text-xl font-semibold">Schedule Management</h1>
      {searchParams.error && <p className="mb-3 text-sm text-red-600">Incorrect password.</p>}
      <form action="/api/login" method="post" className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Shared password"
          className="rounded border border-slate-300 px-3 py-2"
          autoFocus
        />
        <button type="submit" className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
          Enter
        </button>
      </form>
    </main>
  );
}
```

`middleware.ts`:
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthed } from "@/lib/auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!isAuthed(cookie)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 6: Manually verify the gate**

Run: `npm run dev` then visit `/` — expect redirect to `/login`; submit the wrong password → `?error=1`; submit `APP_PASSWORD` → redirected to `/` with the session cookie set. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: shared-password login gate (lib, route, page, middleware)"
```

---

### Task 9: Projects API + projects list + new-project form

**Files:**
- Create: `app/api/projects/route.ts`, `app/projects/new/page.tsx`
- Modify: `app/page.tsx` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `GET /api/projects` → `Project[]` (newest first); `POST /api/projects` (form fields) → 303 redirect to `/projects/{id}`.

- [ ] **Step 1: Write the projects API route**

`app/api/projects/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return NextResponse.redirect(new URL("/projects/new?error=1", req.url), { status: 303 });

  const sizeSqFtRaw = String(form.get("sizeSqFt") ?? "").trim();
  const contractValueRaw = String(form.get("contractValue") ?? "").trim();

  const project = await prisma.project.create({
    data: {
      name,
      client: String(form.get("client") ?? "").trim() || null,
      sector: String(form.get("sector") ?? "").trim() || null,
      buildingType: String(form.get("buildingType") ?? "").trim() || null,
      sizeSqFt: sizeSqFtRaw ? Number(sizeSqFtRaw) : null,
      contractValue: contractValueRaw ? contractValueRaw : null,
      region: String(form.get("region") ?? "").trim() || null,
      deliveryMethod: String(form.get("deliveryMethod") ?? "").trim() || null,
    },
  });
  return NextResponse.redirect(new URL(`/projects/${project.id}`, req.url), { status: 303 });
}
```

- [ ] **Step 2: Write the projects list (home) page**

`app/page.tsx`:
```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { imports: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link href="/projects/new" className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          New Project
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-slate-500">No projects yet. Create one to import a schedule.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-slate-500">{p._count.imports} import(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write the new-project form**

`app/projects/new/page.tsx`:
```tsx
function Field({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <input name={name} type={type} className="rounded border border-slate-300 px-3 py-2" />
    </label>
  );
}

export default function NewProjectPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto max-w-lg p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">New Project</h1>
      {searchParams.error && <p className="mb-3 text-sm text-red-600">Name is required.</p>}
      <form action="/api/projects" method="post" className="flex flex-col gap-3">
        <Field label="Name *" name="name" />
        <Field label="Client" name="client" />
        <Field label="Sector (e.g. Healthcare)" name="sector" />
        <Field label="Building type" name="buildingType" />
        <Field label="Size (sq ft)" name="sizeSqFt" type="number" />
        <Field label="Contract value (USD)" name="contractValue" type="number" />
        <Field label="Region" name="region" />
        <Field label="Delivery method" name="deliveryMethod" />
        <button type="submit" className="mt-2 rounded bg-slate-900 px-3 py-2 font-medium text-white">
          Create Project
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Verify build typechecks**

Run: `npm run build`
Expected: build succeeds (Prisma generates, Next compiles with no type errors).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: projects API, list page, and new-project form"
```

---

### Task 10: Import preview & commit API

**Files:**
- Create: `app/api/imports/preview/route.ts`, `app/api/imports/commit/route.ts`

**Interfaces:**
- Consumes: `previewImport`, `commitImport` (Task 7).
- Produces:
  - `POST /api/imports/preview` (multipart, field `file`) → JSON `{ title, statusDate, suggestedIsBaseline, counts, fieldDefinitions, warnings }`.
  - `POST /api/imports/commit` (multipart: `file`, `projectId`, optional `statusDate`) → JSON `{ id }`.

- [ ] **Step 1: Write the preview route**

`app/api/imports/preview/route.ts`:
```ts
import { NextResponse } from "next/server";
import { previewImport } from "@/lib/import/commitImport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file uploaded." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const { parsed, suggestedIsBaseline } = previewImport(xml);
    return NextResponse.json({
      title: parsed.header.titleFromFile,
      statusDate: parsed.header.statusDate,
      suggestedIsBaseline,
      counts: parsed.counts,
      fieldDefinitions: parsed.fieldDefinitions,
      warnings: parsed.warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse file.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 2: Write the commit route**

`app/api/imports/commit/route.ts`:
```ts
import { NextResponse } from "next/server";
import { commitImport } from "@/lib/import/commitImport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const statusDate = String(form.get("statusDate") ?? "").trim() || null;
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const { id } = await commitImport({ projectId, fileName: file.name, xml, statusDateOverride: statusDate });
    return NextResponse.json({ id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 3: Verify build typechecks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: import preview and commit API routes"
```

---

### Task 11: Import wizard UI

**Files:**
- Create: `components/ImportWizard.tsx`, `app/projects/[id]/import/page.tsx`

**Interfaces:**
- Consumes: `POST /api/imports/preview`, `POST /api/imports/commit` (Task 10).
- Produces: a client wizard that uploads, previews, lets the user confirm the status date, and commits, then navigates to the project view.

- [ ] **Step 1: Write the wizard component**

`components/ImportWizard.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Preview {
  title: string;
  statusDate: string | null;
  suggestedIsBaseline: boolean;
  counts: { activities: number; milestones: number; relationships: number; resources: number };
  fieldDefinitions: { alias: string; fieldName: string }[];
  warnings: string[];
}

export function ImportWizard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [statusDate, setStatusDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/imports/preview", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Preview failed.");
      return;
    }
    const data: Preview = await res.json();
    setPreview(data);
    setStatusDate(data.statusDate ? data.statusDate.slice(0, 16) : "");
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    if (statusDate) fd.append("statusDate", `${statusDate}:00`);
    const res = await fetch("/api/imports/commit", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Import failed.");
      return;
    }
    router.push(`/projects/${projectId}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="file"
        accept=".xml"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
        }}
        className="text-sm"
      />
      {file && !preview && (
        <button onClick={runPreview} disabled={busy} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Reading…" : "Preview import"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {preview && (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm">
          <p className="mb-2 font-medium">{preview.title}</p>
          <ul className="mb-3 grid grid-cols-2 gap-1 text-slate-600">
            <li>Activities: {preview.counts.activities}</li>
            <li>Milestones: {preview.counts.milestones}</li>
            <li>Relationships: {preview.counts.relationships}</li>
            <li>Resources: {preview.counts.resources}</li>
          </ul>
          <p className="mb-2 text-slate-600">
            Baseline detected: {preview.suggestedIsBaseline ? "no (this import will be the baseline)" : "yes"}
          </p>
          {preview.fieldDefinitions.length > 0 && (
            <p className="mb-2 text-slate-600">
              Custom fields: {preview.fieldDefinitions.map((f) => `${f.fieldName}=${f.alias}`).join(", ")}
            </p>
          )}
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-slate-600">Status (data) date {preview.statusDate ? "" : "— not found in file, please set"}</span>
            <input
              type="datetime-local"
              value={statusDate}
              onChange={(e) => setStatusDate(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            />
          </label>
          {preview.warnings.length > 0 && (
            <p className="mb-3 text-amber-600">{preview.warnings.length} warning(s).</p>
          )}
          <button onClick={commit} disabled={busy} className="rounded bg-emerald-700 px-3 py-2 font-medium text-white disabled:opacity-50">
            {busy ? "Importing…" : "Commit import"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the import page**

`app/projects/[id]/import/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ImportWizard } from "@/components/ImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-lg p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">
        ← {project.name}
      </Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">Import schedule (MS Project XML)</h1>
      <ImportWizard projectId={project.id} />
    </main>
  );
}
```

- [ ] **Step 3: Verify build typechecks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: import wizard UI (upload, preview, confirm status date, commit)"
```

---

### Task 12: Verification view

**Files:**
- Create: `components/ActivityTable.tsx`
- Modify: `app/projects/[id]/page.tsx` (created here; replaces nothing — first version)

**Interfaces:**
- Consumes: `prisma` (Task 2). The server page loads the latest `ScheduleImport` and its activities and passes a plain serializable array to the client `ActivityTable`.
- Produces: `ActivityRow` shape consumed by `ActivityTable`:
  ```ts
  interface ActivityRow {
    id: string; externalId: number | null; wbsCode: string | null; name: string;
    type: string; isCritical: boolean; outlineLevel: number;
    plannedStart: string | null; plannedFinish: string | null;
    percentComplete: number | null; totalSlackDays: number | null; durationDays: number | null;
    customFields: Record<string, string>;
  }
  ```

- [ ] **Step 1: Write the ActivityTable client component**

`components/ActivityTable.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";

export interface ActivityRow {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  type: string;
  isCritical: boolean;
  outlineLevel: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  percentComplete: number | null;
  totalSlackDays: number | null;
  durationDays: number | null;
  customFields: Record<string, string>;
}

type Filter = "all" | "milestones" | "critical" | "in_progress";
type Sort = "wbs" | "start" | "slack";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("wbs");
  const [openId, setOpenId] = useState<string | null>(null);

  const view = useMemo(() => {
    let r = rows;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter(
        (a) => a.name.toLowerCase().includes(needle) || (a.wbsCode ?? "").includes(needle) || String(a.externalId ?? "").includes(needle),
      );
    }
    if (filter === "milestones") r = r.filter((a) => a.type === "milestone");
    if (filter === "critical") r = r.filter((a) => a.isCritical);
    if (filter === "in_progress") r = r.filter((a) => (a.percentComplete ?? 0) > 0 && (a.percentComplete ?? 0) < 100);
    const sorted = [...r];
    if (sort === "wbs") sorted.sort((a, b) => (a.wbsCode ?? "").localeCompare(b.wbsCode ?? "", undefined, { numeric: true }));
    if (sort === "start") sorted.sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""));
    if (sort === "slack") sorted.sort((a, b) => (a.totalSlackDays ?? Infinity) - (b.totalSlackDays ?? Infinity));
    return sorted;
  }, [rows, q, filter, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All</option>
          <option value="milestones">Milestones</option>
          <option value="critical">Critical</option>
          <option value="in_progress">In progress</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="wbs">Sort: WBS</option>
          <option value="start">Sort: Start</option>
          <option value="slack">Sort: Float</option>
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{view.length} activities</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.map((a) => (
          <li key={a.id} className="px-3 py-2">
            <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="flex w-full items-start justify-between gap-3 text-left">
              <span>
                <span className="mr-2 text-xs text-slate-400">{a.wbsCode}</span>
                <span className={a.isCritical ? "font-medium text-red-700" : "font-medium"}>{a.name}</span>
                {a.type === "milestone" && <span className="ml-2 text-xs text-indigo-600">◆ milestone</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">
                {fmtDate(a.plannedStart)} → {fmtDate(a.plannedFinish)}
              </span>
            </button>
            {openId === a.id && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <div>ID: {a.externalId ?? "—"}</div>
                <div>% complete: {a.percentComplete ?? "—"}</div>
                <div>Duration (days): {a.durationDays?.toFixed(2) ?? "—"}</div>
                <div>Total float (days): {a.totalSlackDays?.toFixed(2) ?? "—"}</div>
                {Object.entries(a.customFields).map(([k, v]) => (
                  <div key={k}>{k}: {v}</div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write the project verification page**

`app/projects/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";

export const dynamic = "force-dynamic";

function toDays(minutes: number | null, minutesPerDay: number | null): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: { orderBy: { wbsCode: "asc" } } },
  });

  const mpd = latest?.minutesPerDay ?? 480;
  const rows: ActivityRow[] = (latest?.activities ?? []).map((a) => ({
    id: a.id,
    externalId: a.externalId,
    wbsCode: a.wbsCode,
    name: a.name,
    type: a.type,
    isCritical: a.isCritical,
    outlineLevel: a.outlineLevel,
    plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
    plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
    percentComplete: a.percentComplete,
    totalSlackDays: toDays(a.totalSlackMinutes, mpd),
    durationDays: a.durationDays,
    customFields: (a.customFields as Record<string, string>) ?? {},
  }));

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-slate-500">← Projects</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Import schedule
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-600">
        {project.client && <span className="rounded bg-slate-200 px-2 py-1">{project.client}</span>}
        {project.sector && <span className="rounded bg-slate-200 px-2 py-1">{project.sector}</span>}
        {project.sizeSqFt && <span className="rounded bg-slate-200 px-2 py-1">{project.sizeSqFt.toLocaleString()} sf</span>}
      </div>

      {!latest ? (
        <p className="text-slate-500">No schedule imported yet.</p>
      ) : (
        <>
          <div className="mb-4 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
          <ActivityTable rows={rows} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify build typechecks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual end-to-end check (requires DATABASE_URL)**

Run: `npm run dev`, log in, create a project, import `BSW Regional Cath IR Schedule 1.30.26 Baseline.xml`, confirm the preview shows ~277 activities and `Text1=Phoenix ID`, commit, then verify the table renders, search/filter/sort work, and a row expands to show Phoenix ID. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: mobile-first schedule verification view"
```

---

### Task 13: README, env docs, and full test pass

**Files:**
- Create: `README.md`

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# Schedule Management

Standalone, integration-ready scheduling tool for Skiles Group. Slice 1: import a
Microsoft Project XML schedule into a normalized, versioned Postgres model and
verify it in a mobile-first view.

## Stack
Next.js 14 (App Router), Prisma + PostgreSQL, Tailwind, Vitest. Deploys to Railway.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` (Railway Postgres),
   `APP_PASSWORD` (shared login), `APP_SESSION_TOKEN` (long random string).
3. `npx prisma migrate dev` to create the schema.
4. `npm run dev` and open the app; log in with `APP_PASSWORD`.

## Testing
- `npm test` runs the suite. Pure parser/auth tests always run; database and
  `commitImport` tests run only when `DATABASE_URL` is set.

## Importing a schedule
Create a project (capture the minimal profile), then **Import schedule** and
upload an MS Project `.xml` export (File → Save As → XML in MS Project; binary
`.mpp` is not supported). Review the pre-commit preview, confirm the status
(data) date, and commit. Each import is an immutable versioned snapshot.

## Deployment (Railway)
- Provision a PostgreSQL plugin; set `DATABASE_URL` from it.
- Set `APP_PASSWORD` and `APP_SESSION_TOKEN`.
- Build command `npm run build`, start command `npm start`.
- Run `npx prisma migrate deploy` against the Railway database on release.

## Roadmap
See `docs/superpowers/specs/2026-06-17-schedule-management-slice1-design.md` for
the full vision and the six-slice roadmap (lookahead + weekly update loop,
export, more importers, normalization/analytics, proactive reminders).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all suites pass (DB-dependent suites pass when `DATABASE_URL` is set, otherwise skipped).

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: README, setup, and deployment notes for Slice 1"
```

---

## Notes for the implementer

- **Database required for full verification:** parser/auth/unit tests run without a DB, but `commitImport`, the DB test, and the manual E2E need a reachable `DATABASE_URL` (Railway Postgres). Configure `.env` before Tasks 2/7/12.
- **Slack/lag unit check (carried from the spec):** the minimal fixture asserts `TotalSlack=4800` → 480 minutes and `LinkLag=4800` → 480 minutes (tenths-of-a-minute). When importing the first real file, spot-check one activity with known nonzero float against MS Project to confirm the units; if MS Project shows a different value, revisit `tenthsOfMinuteToMinutes`.
- **Date semantics:** every MSPDI datetime is stored by appending `Z` (treated as UTC wall-clock). All display formatting uses `toISOString().slice(...)` so the wall-clock numbers from the file are what users see. Do not introduce `toLocaleString()` without timezone handling, or dates will shift.
- **Immutable snapshots:** never update activities in place. Re-importing creates a new `ScheduleImport`; the view always reads the latest by `importedAt`.
```
