import postgres from "postgres";

// No implicit database or schema: operators must select the intended environment.
const databaseUrl = process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA;
if (!databaseUrl || !schema || !/^[a-z][a-z0-9_]*$/.test(schema)) {
  throw new Error("Explicit DATABASE_URL and DATABASE_SCHEMA are required");
}
const command = process.argv[2] ?? "audit";
if (!["audit", "set-read-only", "resume-v2"].includes(command)) throw new Error("Unknown lifecycle command");
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connection: { application_name: "langreport-lifecycle-v2", search_path: schema },
});
try {
  const result = await sql.begin(async (tx) => {
    if (command === "audit") {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      const rows = Array.from(await tx.unsafe('SELECT * FROM "evidence_integrity_audit" ORDER BY revision_id'));
      const reasons = {};
      for (const row of rows) for (const reason of row.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
      return { schema, revisions: rows.length, reasons, objectBytesVerified: false, rows };
    }
    const mode = command === "set-read-only" ? "read_only" : "writable";
    const rows = await tx`UPDATE chart_lifecycle_control SET mode = ${mode} WHERE id = 'singleton' RETURNING mode`;
    if (rows.length !== 1) throw new Error("Lifecycle singleton missing");
    return { schema, mode: rows[0].mode, writerVersion: "langreport-lifecycle-v2" };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
