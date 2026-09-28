import { config } from "dotenv";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { bootstrapDatabaseUser } from "./user-bootstrap.js";
import { replayMemoryRevocationLedger } from "@langreport/memory";

config({ path: resolve(process.cwd(), "../../.env") });

await replayMemoryRevocationLedger();
await bootstrapDatabaseUser(process.env);
const app = await buildApp();
const port = Number(process.env.API_PORT ?? 4000);

await app.listen({ host: "0.0.0.0", port });
