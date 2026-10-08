import { putObject } from "@langreport/storage";
import { processRenderJob } from "../../../../render-worker/src/index.js";

if (process.env.APP_ENV !== "test" || process.env.LANGREPORT_INTEGRATION_TEST !== "1") {
  throw new Error("This crash fixture requires the isolated integration environment");
}

const jobId = process.argv[2];
if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId) || !process.send) {
  throw new Error("A Job UUID and parent IPC channel are required");
}

await processRenderJob(jobId, putObject, async () => {
  // This callback is reached only after four PUTs, readback and the manifest commit.
  // Exit without unwinding the Worker stack or releasing its lease gracefully.
  process.send!({ phase: "validated", jobId }, () => process.exit(86));
  return await new Promise<never>(() => {});
});

throw new Error("Render Worker returned before reaching the crash boundary");
