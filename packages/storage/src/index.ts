import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });

const bucket = process.env.S3_BUCKET ?? "langreport";
const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";

const client = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "langreport",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "langreport-dev-secret"
  }
});

export async function putObject(input: {
  key: string;
  body: Buffer | string;
  contentType: string;
}): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`对象不存在：${key}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function storageObjectKey(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  kind: "source" | "normalized" | "output";
  filename: string;
}): string {
  return [
    "workspaces",
    input.workspaceId,
    "projects",
    input.projectId,
    "data-assets",
    input.assetId,
    input.kind,
    input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  ].join("/");
}
