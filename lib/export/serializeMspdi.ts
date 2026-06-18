import { XMLParser, XMLBuilder } from "fast-xml-parser";

// Attribute-preserving config so <Project xmlns="..."> survives a round-trip.
// (The importer's parseMspXml uses ignoreAttributes: true and must NOT be reused here.)
const PARSE_OPTS = { ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false } as const;
const BUILD_OPTS = { ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: false, format: false } as const;
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function parseForExport(xml: string): Record<string, unknown> {
  return new XMLParser(PARSE_OPTS).parse(xml) as Record<string, unknown>;
}

export function buildMspdi(doc: Record<string, unknown>): string {
  const body = new XMLBuilder(BUILD_OPTS).build(doc);
  return body.startsWith("<?xml") ? body : `${DECLARATION}\n${body}`;
}
