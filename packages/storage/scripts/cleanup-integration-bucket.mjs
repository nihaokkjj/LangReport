import { DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { assertIsolatedIntegrationEnvironment } from "../../../scripts/integration-environment.mjs";

assertIsolatedIntegrationEnvironment(process.env);

const client = new S3Client({
  region: "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY
  }
});

try {
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, ContinuationToken: continuationToken }));
    const objects = page.Contents?.flatMap((object) => object.Key ? [{ Key: object.Key }] : []) ?? [];
    if (objects.length > 0) await client.send(new DeleteObjectsCommand({ Bucket: process.env.S3_BUCKET, Delete: { Objects: objects, Quiet: true } }));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  await client.send(new DeleteBucketCommand({ Bucket: process.env.S3_BUCKET }));
} finally {
  client.destroy();
}
