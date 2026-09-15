import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
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
  await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
} finally {
  client.destroy();
}
