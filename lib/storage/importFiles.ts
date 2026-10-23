// Original import files, kept in a private S3 bucket so exports and later
// re-extraction can use them without asking for a re-upload. Server-only access;
// nothing here hands out URLs.

import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface ImportFileStore {
  put(key: string, body: string): Promise<void>;
  /** null when the object doesn't exist. */
  get(key: string): Promise<string | null>;
}

let store: ImportFileStore | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to store import files.`);
  return value;
}

function s3Store(): ImportFileStore {
  const bucket = requiredEnv("AWS_BUCKET");
  const client = new S3Client({
    region: requiredEnv("AWS_REGION"),
    credentials: {
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
  return {
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/xml" }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await res.Body?.transformToString("utf-8")) ?? null;
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
  };
}

// ponytail: in-process only — lost on restart. Fine for local dev and tests; never production.
function memoryStore(): ImportFileStore {
  const objects = new Map<string, string>();
  return {
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
  };
}

function getStore(): ImportFileStore {
  if (store) return store;
  if (process.env.AWS_BUCKET) store = s3Store();
  else if (process.env.NODE_ENV !== "production") store = memoryStore();
  else throw new Error("AWS_BUCKET must be set in production so imports keep their original file.");
  return store;
}

export function importFileKey(projectId: string, fileHash: string): string {
  return `imports/${projectId}/${fileHash}.xml`;
}

export async function putImportFile(key: string, xml: string): Promise<void> {
  await getStore().put(key, xml);
}

export async function getImportFile(key: string): Promise<string | null> {
  return getStore().get(key);
}

export function resetImportFileStoreForTests(): void {
  store = null;
}
