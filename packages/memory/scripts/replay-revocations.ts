import { closeDatabase } from "@langreport/db";
import { replayMemoryRevocationLedger } from "../src/index.js";

try {
  if (!process.env.MEMORY_REVOCATION_LEDGER_DIR)
    throw new Error("MEMORY_REVOCATION_LEDGER_DIR must point to the explicitly provisioned ledger volume");
  await replayMemoryRevocationLedger();
  console.log("Memory revocation ledger replay completed.");
} catch {
  console.error("Memory revocation replay failed; service must remain closed.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
