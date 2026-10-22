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

  it("refuses to run in production without a configured provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IMPORT_STORAGE_PROVIDER", "");
    await expect(putImportFile("k", "x")).rejects.toThrow(/IMPORT_STORAGE_PROVIDER/);
  });

  it("requires bucket and credentials for s3", async () => {
    vi.stubEnv("IMPORT_STORAGE_PROVIDER", "s3");
    vi.stubEnv("IMPORT_STORAGE_BUCKET", "");
    await expect(putImportFile("k", "x")).rejects.toThrow(/IMPORT_STORAGE_BUCKET/);
  });
});
