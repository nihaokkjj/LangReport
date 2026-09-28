import { closeDatabase } from "@langreport/db";
import { initializeMemoryRevocationLedger } from "../src/index.js";

try {
  if (!process.env.MEMORY_REVOCATION_LEDGER_DIR)
    throw new Error("MEMORY_REVOCATION_LEDGER_DIR must point to the explicitly provisioned ledger volume");
  await initializeMemoryRevocationLedger();
  console.log("Memory revocation ledger initialized or recovered.");
} catch {
  console.error("Memory revocation ledger initialization failed; service must remain closed.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
