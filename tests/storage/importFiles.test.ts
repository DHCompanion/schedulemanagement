import { describe, it, expect, afterEach, vi } from "vitest";
import { getImportFile, importFileKey, putImportFile, resetImportFileStoreForTests } from "@/lib/storage/importFiles";

afterEach(() => {
  vi.unstubAllEnvs();
  resetImportFileStoreForTests();
});

describe("importFiles", () => {
  it("keys files by project and content hash", () => {
    expect(importFileKey("p1", "abc")).toBe("imports/p1/abc.xml");
  });

  it("round-trips through the in-memory store outside production", async () => {
    await putImportFile("imports/p1/abc.xml", "<Project/>");
    expect(await getImportFile("imports/p1/abc.xml")).toBe("<Project/>");
    expect(await getImportFile("imports/p1/missing.xml")).toBeNull();
  });

  it("refuses to run in production without a bucket", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AWS_BUCKET", "");
    await expect(putImportFile("k", "x")).rejects.toThrow(/AWS_BUCKET/);
  });

  it("requires region and credentials once a bucket is set", async () => {
    vi.stubEnv("AWS_BUCKET", "b");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    await expect(putImportFile("k", "x")).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
  });
});
