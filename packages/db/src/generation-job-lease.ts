import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./client.js";
import { generationJobs } from "./schema.js";

export type GenerationJobStatus = typeof generationJobs.$inferSelect["status"];

export type GenerationJobLease = {
  jobId: string;
  owner: string;
  token: string;
  fencingToken: number;
  leaseDurationMs: number;
};

export class GenerationJobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Generation Job ${jobId} 的 Worker 租约已失效`);
    this.name = "GenerationJobLeaseLostError";
  }
}

export const generationJobRunningStatuses = [
  "profiling",
  "planning",
  "transforming",
  "compiling",
  "rendering",
  "validating"
] as const satisfies readonly GenerationJobStatus[];

const generationJobRecoveryStatuses = ["profiling", "planning", "transforming", "compiling"] as const satisfies readonly GenerationJobStatus[];
const renderJobRecoveryStatuses = ["rendering", "validating"] as const satisfies readonly GenerationJobStatus[];

export async function claimGenerationJobLease(input: {
  jobId: string;
  owner: string;
  currentStatuses: readonly GenerationJobStatus[];
  nextStatus: GenerationJobStatus;
  leaseDurationMs: number;
  incrementAttempt?: boolean;
}): Promise<GenerationJobLease | undefined> {
  assertLeaseDuration(input.leaseDurationMs);
  const now = new Date();
  const token = randomUUID();
  const [claimed] = await db.update(generationJobs).set({
    status: input.nextStatus,
    leaseOwner: input.owner,
    leaseToken: token,
    leaseFencingToken: sql`${generationJobs.leaseFencingToken} + 1`,
    leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
    leaseHeartbeatAt: now,
    ...(input.incrementAttempt ? { attemptCount: sql`${generationJobs.attemptCount} + 1` } : {}),
    updatedAt: now
  } as never).where(and(
    eq(generationJobs.id, input.jobId),
    inArray(generationJobs.status, [...input.currentStatuses]),
    or(isNull(generationJobs.leaseExpiresAt), lt(generationJobs.leaseExpiresAt, now))
  )).returning({ fencingToken: generationJobs.leaseFencingToken });
  if (!claimed) return undefined;
  return {
    jobId: input.jobId,
    owner: input.owner,
    token,
    fencingToken: claimed.fencingToken,
    leaseDurationMs: input.leaseDurationMs
  };
}

export async function heartbeatGenerationJobLease(lease: GenerationJobLease): Promise<boolean> {
  const now = new Date();
  const [renewed] = await db.update(generationJobs).set({
    leaseExpiresAt: new Date(now.getTime() + lease.leaseDurationMs),
    leaseHeartbeatAt: now,
    updatedAt: now
  }).where(ownedLeaseCondition(lease, now)).returning({ id: generationJobs.id });
  return Boolean(renewed);
}

export async function updateGenerationJobUnderLease(input: {
  lease: GenerationJobLease;
  status?: GenerationJobStatus;
  values?: Record<string, unknown>;
  release?: boolean;
}): Promise<boolean> {
  const now = new Date();
  const [updated] = await db.update(generationJobs).set({
    ...(input.values ?? {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.release ? {
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null
    } : {}),
    updatedAt: now
  } as never).where(ownedLeaseCondition(input.lease, now)).returning({ id: generationJobs.id });
  return Boolean(updated);
}

export async function recoverExpiredGenerationJobLeases(): Promise<string[]> {
  const now = new Date();
  const recoveryValues = {
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    errorCode: "WORKER_LEASE_EXPIRED",
    errorMessage: "Worker 租约已过期，任务已重新排队",
    updatedAt: now
  };
  const generationRecovered = await db.update(generationJobs).set({
    ...recoveryValues,
    status: "queued",
  }).where(and(
    inArray(generationJobs.status, [...generationJobRecoveryStatuses]),
    isNotNull(generationJobs.leaseExpiresAt),
    lt(generationJobs.leaseExpiresAt, now)
  )).returning({ id: generationJobs.id });
  const renderRecovered = await db.update(generationJobs).set({
    ...recoveryValues,
    status: "rendering"
  }).where(and(
    inArray(generationJobs.status, [...renderJobRecoveryStatuses]),
    isNotNull(generationJobs.leaseExpiresAt),
    lt(generationJobs.leaseExpiresAt, now)
  )).returning({ id: generationJobs.id });
  return [...generationRecovered, ...renderRecovered].map((job) => job.id);
}

export function startGenerationJobLeaseHeartbeat(lease: GenerationJobLease): {
  stop(): void;
  hasLostLease(): boolean;
} {
  const intervalMs = Math.max(1_000, Math.floor(lease.leaseDurationMs / 3));
  let stopped = false;
  let renewing = false;
  let lostLease = false;
  const heartbeat = async () => {
    if (stopped || renewing || lostLease) return;
    renewing = true;
    try {
      if (!await heartbeatGenerationJobLease(lease)) lostLease = true;
    } catch {
      // A transient database failure must not claim the lease is still valid.
      lostLease = true;
    } finally {
      renewing = false;
    }
  };
  const timer = setInterval(() => { void heartbeat(); }, intervalMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    hasLostLease() {
      return lostLease;
    }
  };
}

export async function assertGenerationJobLease(lease: GenerationJobLease): Promise<void> {
  if (!await heartbeatGenerationJobLease(lease)) throw new GenerationJobLeaseLostError(lease.jobId);
}

function ownedLeaseCondition(lease: GenerationJobLease, now: Date) {
  return and(
    eq(generationJobs.id, lease.jobId),
    eq(generationJobs.leaseOwner, lease.owner),
    eq(generationJobs.leaseToken, lease.token),
    eq(generationJobs.leaseFencingToken, lease.fencingToken),
    gt(generationJobs.leaseExpiresAt, now)
  );
}

function assertLeaseDuration(value: number): void {
  if (!Number.isFinite(value) || value < 3_000) throw new Error("Generation Job 租约时长必须至少为 3 秒");
}
