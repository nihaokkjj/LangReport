import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  GenerationJobLeaseLostError,
  chartRevisions,
  db,
  generationJobs,
  projects,
  renderCandidateAttempts,
  type GenerationJobLease,
} from "@langreport/db";
import { deleteObject, renderOutputObjectKey } from "@langreport/storage";

export type CandidateOutputKeys = Record<"vegaLite" | "svg" | "png" | "html", string>;

const formats = ["vegaLite", "svg", "png", "html"] as const;
const extensions = { vegaLite: "vega-lite.json", svg: "svg", png: "png", html: "html" } as const;
const retentionMs = 24 * 60 * 60 * 1000;
const retryDelayMs = 60_000;

/** The ledger commit precedes every S3 PUT, including the first one. */
export async function recordCandidateAttempt(input: {
  lease: GenerationJobLease;
  attemptId: string;
  revisionId: string;
  outputKeys: CandidateOutputKeys;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.id, input.lease.jobId)).for("update");
    if (!job || !ownsLiveLease(job, input.lease) || job.candidateRevisionId !== input.revisionId)
      throw new GenerationJobLeaseLostError(input.lease.jobId);
    const [project] = await tx
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, job.projectId));
    if (
      !project ||
      !validOutputKeys(
        input.outputKeys,
        project.workspaceId,
        job.projectId,
        job.dataAssetId,
        input.revisionId,
        input.attemptId,
      )
    )
      throw new Error("候选对象键与 Job 身份不匹配");
    await tx.insert(renderCandidateAttempts).values({
      id: input.attemptId,
      generationJobId: job.id,
      revisionId: input.revisionId,
      leaseFencingToken: input.lease.fencingToken,
      outputKeys: input.outputKeys,
    });
  });
}

/** A validated manifest and its ledger state become visible together. */
export async function validateCandidateAttempt(input: {
  lease: GenerationJobLease;
  attemptId: string;
  manifest: unknown;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.id, input.lease.jobId)).for("update");
    if (!job || !ownsLiveLease(job, input.lease)) throw new GenerationJobLeaseLostError(input.lease.jobId);
    const [attempt] = await tx
      .select()
      .from(renderCandidateAttempts)
      .where(eq(renderCandidateAttempts.id, input.attemptId))
      .for("update");
    if (
      !attempt ||
      attempt.generationJobId !== job.id ||
      attempt.leaseFencingToken !== input.lease.fencingToken ||
      attempt.status !== "writing"
    )
      throw new GenerationJobLeaseLostError(input.lease.jobId);
    await tx
      .update(renderCandidateAttempts)
      .set({ status: "validated", updatedAt: new Date() })
      .where(eq(renderCandidateAttempts.id, attempt.id));
    await tx
      .update(generationJobs)
      .set({ candidateOutputManifest: input.manifest, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
  });
}

/** Delete aged, unreferenced candidates with no live Job lease. Revisit deleted rows for late S3 PUTs. */
export async function reconcileOrphanRenderCandidates(
  options: {
    now?: Date;
    retentionMs?: number;
    limit?: number;
    jobId?: string;
    remove?: typeof deleteObject;
  } = {},
): Promise<number> {
  const age = options.retentionMs ?? retentionMs;
  const limit = options.limit ?? 10;
  if (!Number.isFinite(age) || age < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("候选对账参数无效");
  const cutoff = options.now
    ? new Date(options.now.getTime() - age)
    : sql`clock_timestamp() - ${age} * interval '1 millisecond'`;
  const retryCutoff = options.now
    ? new Date(options.now.getTime() - retryDelayMs)
    : sql`clock_timestamp() - ${retryDelayMs} * interval '1 millisecond'`;
  const timestamp = options.now ?? sql`clock_timestamp()`;
  const eligible = or(
    and(
      inArray(renderCandidateAttempts.status, ["writing", "validated"]),
      lte(renderCandidateAttempts.createdAt, cutoff),
    ),
    and(eq(renderCandidateAttempts.status, "deleting"), lte(renderCandidateAttempts.updatedAt, retryCutoff)),
    and(eq(renderCandidateAttempts.status, "deleted"), lte(renderCandidateAttempts.updatedAt, cutoff)),
  );
  const candidates = await db
    .select({ id: renderCandidateAttempts.id })
    .from(renderCandidateAttempts)
    .innerJoin(generationJobs, eq(generationJobs.id, renderCandidateAttempts.generationJobId))
    .where(
      and(
        eligible,
        or(isNull(generationJobs.leaseExpiresAt), lte(generationJobs.leaseExpiresAt, sql`clock_timestamp()`)),
        ...(options.jobId ? [eq(renderCandidateAttempts.generationJobId, options.jobId)] : []),
      ),
    )
    .orderBy(renderCandidateAttempts.updatedAt)
    .limit(limit);
  let cleaned = 0;
  for (const { id } of candidates) {
    try {
      const keys = await db.transaction(async (tx) => {
        // Lock order matches publication: Job, then attempt. A retry with a live lease defers cleanup.
        const [candidate] = await tx.select().from(renderCandidateAttempts).where(eq(renderCandidateAttempts.id, id));
        if (!candidate) return null;
        const [job] = await tx
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.id, candidate.generationJobId))
          .for("update");
        if (!job) return null;
        const [leaseState] = await tx
          .select({ active: sql<boolean>`${generationJobs.leaseExpiresAt} > clock_timestamp()` })
          .from(generationJobs)
          .where(eq(generationJobs.id, job.id));
        if (leaseState?.active) return null;
        const [attempt] = await tx
          .select()
          .from(renderCandidateAttempts)
          .where(and(eq(renderCandidateAttempts.id, id), eligible))
          .for("update");
        if (!attempt) return null;
        const [project] = await tx
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, job.projectId));
        if (
          !project ||
          !validOutputKeys(
            attempt.outputKeys,
            project.workspaceId,
            job.projectId,
            job.dataAssetId,
            attempt.revisionId,
            attempt.id,
          )
        ) {
          await tx
            .update(renderCandidateAttempts)
            .set({ status: "quarantined", updatedAt: timestamp })
            .where(eq(renderCandidateAttempts.id, id));
          console.error("render-worker quarantined invalid candidate keys", { attemptId: id });
          return null;
        }
        const outputKeys = attempt.outputKeys as CandidateOutputKeys;
        const values = formats.map((format) => outputKeys[format]);
        const [referenced] = await tx
          .select({ id: chartRevisions.id })
          .from(chartRevisions)
          .where(
            or(
              sql`${chartRevisions.outputObjects}->>'vegaLite' IN (${sql.join(
                values.map((key) => sql`${key}`),
                sql`, `,
              )})`,
              sql`${chartRevisions.outputObjects}->>'svg' IN (${sql.join(
                values.map((key) => sql`${key}`),
                sql`, `,
              )})`,
              sql`${chartRevisions.outputObjects}->>'png' IN (${sql.join(
                values.map((key) => sql`${key}`),
                sql`, `,
              )})`,
              sql`${chartRevisions.outputObjects}->>'html' IN (${sql.join(
                values.map((key) => sql`${key}`),
                sql`, `,
              )})`,
            ),
          )
          .limit(1);
        if (referenced) {
          await tx
            .update(renderCandidateAttempts)
            .set({ status: "published", updatedAt: timestamp })
            .where(eq(renderCandidateAttempts.id, id));
          return null;
        }
        if (attempt.status !== "deleting")
          await tx
            .update(renderCandidateAttempts)
            .set({ status: "deleting", updatedAt: timestamp })
            .where(eq(renderCandidateAttempts.id, id));
        return values;
      });
      if (!keys) continue;
      // A partial S3 failure leaves 'deleting' for a later sweep. DELETE is idempotent.
      for (const key of keys) await (options.remove ?? deleteObject)(key);
      await db
        .update(renderCandidateAttempts)
        .set({ status: "deleted", deletedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(renderCandidateAttempts.id, id), eq(renderCandidateAttempts.status, "deleting")));
      cleaned++;
    } catch (error) {
      console.error("render-worker candidate reconciliation failed", { attemptId: id, error });
      await db
        .update(renderCandidateAttempts)
        .set({ updatedAt: timestamp })
        .where(and(eq(renderCandidateAttempts.id, id), eq(renderCandidateAttempts.status, "deleting")))
        .catch((updateError) =>
          console.error("render-worker could not defer candidate retry", { attemptId: id, updateError }),
        );
    }
  }
  return cleaned;
}

function ownsLiveLease(job: typeof generationJobs.$inferSelect, lease: GenerationJobLease): boolean {
  return (
    job.leaseOwner === lease.owner &&
    job.leaseToken === lease.token &&
    job.leaseFencingToken === lease.fencingToken &&
    Boolean(job.leaseExpiresAt && job.leaseExpiresAt > new Date()) &&
    ["rendering", "validating"].includes(job.status)
  );
}

function validOutputKeys(
  value: unknown,
  workspaceId: string,
  projectId: string,
  assetId: string,
  revisionId: string,
  attemptId: string,
): value is CandidateOutputKeys {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== formats.length)
    return false;
  const keys = value as Record<string, unknown>;
  return formats.every((format) => {
    const prefix = renderOutputObjectKey({ workspaceId, projectId, assetId, filename: `${revisionId}.${attemptId}.` });
    const key = keys[format];
    return (
      typeof key === "string" &&
      key.startsWith(prefix) &&
      new RegExp(`^[0-9a-f]{16}\\.${extensions[format].replaceAll(".", "\\.")}$`).test(key.slice(prefix.length))
    );
  });
}
