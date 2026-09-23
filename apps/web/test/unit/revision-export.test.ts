import assert from "node:assert/strict";
import test from "node:test";
import { revisionOutputFilename, revisionOutputPath } from "../../features/evidence/revision-export";

test("fixed Revision export paths and filenames remain stable", () => {
  assert.equal(revisionOutputPath("revision-1", "svg"), "/api/v1/chart-revisions/revision-1/outputs/svg");
  assert.equal(revisionOutputPath("revision-1", "vegaLite"), "/api/v1/chart-revisions/revision-1/outputs/vegaLite");
  assert.equal(revisionOutputFilename(3, "png"), "langreport-revision-r3.png");
  assert.equal(revisionOutputFilename(3, "vegaLite"), "langreport-revision-r3.json");
});
