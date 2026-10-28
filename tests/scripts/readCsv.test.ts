import { describe, expect, it } from "vitest";
import { readCsv } from "@/scripts/readCsv";

describe("readCsv", () => {
  it("reads quoted fields, doubled quotes and CRLF, and drops a BOM", () => {
    expect(readCsv('﻿name,note\r\n"Frame, Walls","say ""hi"""\r\nPaint,\r\n')).toEqual([
      { name: "Frame, Walls", note: 'say "hi"' },
      { name: "Paint", note: "" },
    ]);
  });
});
