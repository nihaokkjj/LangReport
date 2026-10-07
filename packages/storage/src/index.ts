import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { resolve } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function assertIsolatedIntegrationStorage(): void {
  if (process.env.LANGREPORT_INTEGRATION_TEST !== "1") return;
  if (process.env.APP_ENV !== "test") throw new Error("Integration storage requires APP_ENV=test");
  if (process.env.S3_ENDPOINT !== "http://127.0.0.1:9002")
    throw new Error("Integration storage must use the test Compose MinIO endpoint");
  if (!process.env.S3_BUCKET?.startsWith("langreport-test-"))
    throw new Error("Integration storage bucket must start with langreport-test-");
}

if (process.env.LANGREPORT_OFFLINE_TEST !== "1" && process.env.LANGREPORT_INTEGRATION_TEST !== "1") {
  config({ path: resolve(process.cwd(), "../../.env") });
}

assertIsolatedIntegrationStorage();

const bucket = process.env.S3_BUCKET ?? "langreport";
const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";

const client = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "langreport",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "langreport-dev-secret",
  },
});

export async function putObject(input: {
  key: string;
  body: Buffer | string;
  contentType: string;
  signal?: AbortSignal;
}): Promise<void> {
  assertIsolatedIntegrationStorage();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
    { abortSignal: input.signal },
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`对象不存在：${key}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

/** Stream original uploads; do not allocate a second whole-file Buffer in API/Worker. */
export async function putObjectFile(input: {
  key: string;
  path: string;
  contentType: string;
  signal?: AbortSignal;
}): Promise<void> {
  assertIsolatedIntegrationStorage();
  const file = await stat(input.path);
  const body = createReadStream(input.path);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: body,
        ContentLength: file.size,
        ContentType: input.contentType,
      }),
      { abortSignal: input.signal },
    );
  } finally {
    body.destroy();
  }
}

export async function getObjectFile(key: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<void> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
  if (!response.Body) throw new Error("源文件不存在");
  const body = response.Body as Readable;
  let count = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      count += chunk.length;
      callback(count > maxBytes ? new Error("源文件超出读取上限") : null, chunk);
    },
  });
  try {
    await pipeline(body, limit, createWriteStream(path, { flags: "wx" }), { signal });
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  } finally {
    body.destroy();
  }
}

export async function deleteObject(key: string): Promise<void> {
  assertIsolatedIntegrationStorage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Render outputs are kept under the project asset for revision export lookup. */
export function renderOutputObjectKey(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  filename: string;
}): string {
  return [
    "workspaces",
    input.workspaceId,
    "projects",
    input.projectId,
    "data-assets",
    input.assetId,
    "output",
    input.filename.replace(/[^a-zA-Z0-9._-]/g, "_"),
  ].join("/");
}

/** Keep uploads discoverable by their originating Conversation. */
export function conversationUploadObjectKey(input: {
  workspaceId: string;
  projectId: string;
  conversationId: string;
  assetId: string;
  kind: "source" | "normalized";
  filename: string;
}): string {
  return [
    "workspaces",
    input.workspaceId,
    "projects",
    input.projectId,
    "conversations",
    input.conversationId,
    "user-data",
    "uploads",
    input.assetId,
    input.kind === "normalized" ? "snapshots" : "source",
    input.filename.replace(/[^a-zA-Z0-9._-]/g, "_"),
  ].join("/");
}

/** Keep each raw input isolated by the immutable Data Snapshot it created. */
export function snapshotSourceObjectKey(input: {
  workspaceId: string;
  projectId: string;
  conversationId: string;
  assetId: string;
  snapshotId: string;
  filename: string;
}): string {
  return [
    "workspaces",
    input.workspaceId,
    "projects",
    input.projectId,
    "conversations",
    input.conversationId,
    "user-data",
    "uploads",
    input.assetId,
    "snapshots",
    input.snapshotId,
    "source",
    input.filename.replace(/[^a-zA-Z0-9._-]/g, "_"),
  ].join("/");
}
