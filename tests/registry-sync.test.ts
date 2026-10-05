import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import manifest from "../tool.manifest.json";

// D1 — split manifest ownership. The in-repo manifest declares only the
// TOOL-AUTHORED fields (what this code implements): emittedEvents, contextExposures
// packetTypes + description, contextDependencies, capabilityRequests. Operational
// fields (lifecycle, launch URLs, allowedRequestingTools, slug authority) are
// REGISTRY-authoritative and are absent here — so this test asserts equality on the
// tool-authored set ONLY, and must never compare an operational field.
//
// Checked whenever the OS repo is checked out beside this one (dev boxes); skipped
// in CI, where the OS registry isn't present.
const OS_REGISTRY =
  process.env.OS_REGISTRY_PATH ?? "../skiles-group-connect-v1/backend/src/core/moduleRegistry/moduleRegistry.ts";

// The object literal that encloses `at`, found by balanced braces. Registry entries
// order `slug` AFTER nested objects like `launch: {…}`, so a plain lastIndexOf("{")
// would land on the nested brace and miss the rest of the entry.
// ponytail: assumes no braces inside registry strings; fine for today's registry.
function enclosingObject(src: string, at: number): string {
  let depth = 0;
  let start = at;
  for (; start >= 0; start--) {
    if (src[start] === "}") depth++;
    else if (src[start] === "{" && depth-- === 0) break;
  }
  if (start < 0) return "";
  depth = 0;
  for (let end = start; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}" && --depth === 0) return src.slice(start, end + 1);
  }
  return "";
}

// The string literals in `key: [ … ]` inside the block (first occurrence).
function stringArray(block: string, key: string): string[] {
  const body = block.match(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? "";
  return [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe.skipIf(!existsSync(OS_REGISTRY))("OS registry ↔ in-repo manifest sync (tool-authored fields only)", () => {
  // vitest runs a skipped describe's body to collect it, so guard the read too (CI has no OS checkout).
  const src = (existsSync(OS_REGISTRY) ? readFileSync(OS_REGISTRY, "utf8") : "").replace(/\/\/.*$/gm, ""); // drop line comments
  const at = src.indexOf(`slug: "${manifest.slug}"`);
  const block = at >= 0 ? enclosingObject(src, at) : "";

  it("declares the tool", () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toContain(`slug: "${manifest.slug}"`);
  });

  it("emitted events match exactly (neither side declares one the other doesn't)", () => {
    // <slug>.session.launched is emitted by the gateway ABOUT the tool, so only the
    // registry declares it.
    const osEvents = stringArray(block, "emittedEvents").filter((e) => e !== `${manifest.slug}.session.launched`);
    expect(new Set(osEvents)).toEqual(new Set(manifest.emittedEvents));
  });

  it("capability requests match exactly", () => {
    expect(new Set(stringArray(block, "capabilityRequests"))).toEqual(new Set(manifest.capabilityRequests));
  });

  it("exposed packet types and dependencies match", () => {
    for (const ex of manifest.contextExposures) expect(block).toContain(`packetType: "${ex.packetType}"`);
    for (const d of manifest.contextDependencies) {
      expect(block).toContain(`target: "${d.target}"`);
      for (const p of d.packetTypes) expect(block).toContain(`"${p}"`);
    }
  });

  // Deliberately NOT asserted (registry-authoritative, absent from this manifest):
  // lifecycle, launch URLs / contextEndpoint, allowedRequestingTools, slug authority.
});
