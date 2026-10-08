import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function legacyRows(tx) {
  return Array.from(
    await tx.unsafe(`SELECT to_jsonb(r) - 'integrity_status' AS body FROM chart_revisions r ORDER BY id`),
  );
}
export async function seedLegacyEvidence(tx) {
  await tx.unsafe(`
    INSERT INTO generation_jobs (id, project_id, conversation_id, data_asset_id, snapshot_id, prompt, idempotency_key, input_fingerprint, created_by)
    VALUES ('${id(0x36)}', '${id(2)}', '${id(5)}', '${id(9)}', '${id(0xa)}', '历史问题', 't9-legacy', 't9-fingerprint', 'historical-user');
    INSERT INTO chart_artifacts (id, project_id, name, created_by) VALUES ('${id(0x37)}', '${id(2)}', 'Legacy Approved', 'historical-user');
    INSERT INTO chart_revisions (id, artifact_id, generation_job_id, snapshot_id, revision, created_by, transform_plan, field_lineage, flint_spec, theme_snapshot, vega_lite_spec, validation, output_objects)
    VALUES ('${id(0x38)}', '${id(0x37)}', '${id(0x36)}', '${id(0xa)}', 1, 'historical-user', '{}', '[]', '{}', '{}', '{}', '{"valid":true}', '{"svg":"historical.svg"}');
    UPDATE chart_revisions SET status = 'approved' WHERE id = '${id(0x38)}';
    INSERT INTO generation_jobs (id, project_id, conversation_id, data_asset_id, snapshot_id, prompt, idempotency_key, input_fingerprint, created_by)
    SELECT '${id(0x21)}', project_id, conversation_id, data_asset_id, snapshot_id, prompt, 't9-duplicate', input_fingerprint, created_by FROM generation_jobs WHERE id = '${id(0x36)}';
    INSERT INTO evidence_blocks (id, project_id, conversation_id, generation_job_id, chart_artifact_id, chart_revision_id, snapshot_id, title, finding, created_by)
    VALUES ('${id(0x22)}', '${id(2)}', '${id(5)}', '${id(0x36)}', '${id(0x37)}', '${id(0x38)}', '${id(0xa)}', 'Historical approved', 'Original finding', 'historical-user'),
    ('${id(0x23)}', '${id(2)}', '${id(5)}', '${id(0x21)}', '${id(0x37)}', '${id(0x38)}', '${id(0xa)}', 'Mixed duplicate', 'Original mixed finding', 'historical-user');
  `);
  return {
    revisionHash: hash(await legacyRows(tx)),
    snapshotHash: hash(Array.from(await tx.unsafe("SELECT to_jsonb(s) AS body FROM data_snapshots s ORDER BY id"))),
    evidence: Array.from(await tx.unsafe("SELECT to_jsonb(b) AS body FROM evidence_blocks b ORDER BY id")),
  };
}
export async function verifyEvidenceLifecycle(tx, before) {
  assert.equal(
    hash(Array.from(await tx.unsafe("SELECT to_jsonb(s) AS body FROM data_snapshots s ORDER BY id"))),
    before.snapshotHash,
  );
  assert.equal(hash(await legacyRows(tx)), before.revisionHash, "migration must preserve all legacy Revision fields");
  const evidence = Array.from(
    await tx.unsafe("SELECT to_jsonb(b) - 'binding_version' AS body FROM evidence_blocks b ORDER BY id"),
  );
  assert.deepEqual(evidence, before.evidence, "duplicate historical Evidence must remain byte-equivalent JSON");
  const audit = await tx.unsafe("SELECT * FROM evidence_integrity_audit ORDER BY revision_id");
  assert.ok(audit.every((row) => row.integrity_status === "legacy_unverified"));
  const approved = audit.find((row) => row.revision_id === id(0x38));
  assert.equal(approved.status, "approved");
  assert.equal(Number(approved.evidence_count), 2);
  assert.ok(approved.reasons.includes("duplicate_evidence"));
  assert.ok(approved.reasons.includes("mixed_evidence_binding"));
  assert.ok(approved.reasons.includes("missing_provenance"));
  assert.ok(audit.some((row) => row.reasons.includes("missing_successful_job")));
  const rejected = async (name, query, code) => {
    await assert.rejects(
      tx.savepoint(name, async (sp) => {
        await sp.unsafe(query);
      }),
      (error) => error.code === code,
    );
  };
  await tx.unsafe("UPDATE chart_lifecycle_control SET mode = 'read_only'");
  await rejected("readonly", "UPDATE chart_artifacts SET name = name", "55000");
  assert.equal(hash(await legacyRows(tx)), before.revisionHash);
  await tx.unsafe("UPDATE chart_lifecycle_control SET mode = 'writable'");
  await rejected(
    "old_writer",
    "SET LOCAL application_name = 'legacy-worker'; UPDATE chart_artifacts SET name = name",
    "55000",
  );
  await tx.unsafe("UPDATE chart_artifacts SET name = name");
  // A new Revision does not inherit legacy ambiguity; its Evidence uses the new partial constraint.
  await tx.unsafe(`
    INSERT INTO generation_jobs (id, project_id, conversation_id, data_asset_id, snapshot_id, prompt, idempotency_key, input_fingerprint, created_by)
    SELECT '${id(0x26)}', project_id, conversation_id, data_asset_id, snapshot_id, prompt, 't9-new', input_fingerprint, created_by FROM generation_jobs WHERE id = '${id(0x36)}';
    INSERT INTO chart_revisions (id, artifact_id, snapshot_id, generation_job_id, revision, created_by, transform_plan, field_lineage, flint_spec, theme_snapshot, vega_lite_spec, validation, output_objects, integrity_status)
    SELECT '${id(0x24)}', artifact_id, snapshot_id, '${id(0x26)}', 2, created_by, transform_plan, field_lineage, flint_spec, theme_snapshot, vega_lite_spec, validation, output_objects, 'verified' FROM chart_revisions WHERE id = '${id(0x38)}';
    INSERT INTO evidence_blocks (id, project_id, conversation_id, generation_job_id, chart_artifact_id, chart_revision_id, snapshot_id, title, finding, created_by, binding_version)
    SELECT '${id(0x25)}', project_id, conversation_id, '${id(0x26)}', chart_artifact_id, '${id(0x24)}', snapshot_id, title, finding, created_by, 2 FROM evidence_blocks WHERE id = '${id(0x22)}';
  `);
  await rejected(
    "mixed_new",
    `UPDATE evidence_blocks SET chart_artifact_id = '${id(0x11)}' WHERE id = '${id(0x25)}'`,
    "23514",
  );
  await rejected("legacy_new", `UPDATE evidence_blocks SET binding_version = 1 WHERE id = '${id(0x25)}'`, "23514");
  await rejected(
    "duplicate_new",
    `INSERT INTO evidence_blocks (id, project_id, conversation_id, generation_job_id, chart_artifact_id, chart_revision_id, snapshot_id, title, finding, created_by, binding_version) SELECT '${id(0x27)}', project_id, conversation_id, generation_job_id, chart_artifact_id, chart_revision_id, snapshot_id, title, finding, created_by, binding_version FROM evidence_blocks WHERE id = '${id(0x25)}'`,
    "23505",
  );
  console.log("TP23 historical migration/audit/read-only/version recovery assertions passed", {
    legacyRevisionSHA256: before.revisionHash,
  });
}
