export type GenerationJobStatusSnapshot = {
  job: {
    id: string;
    status: string;
    operation?: string;
    attemptCount: number;
    repairCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    clarificationProposal: unknown;
    statusVersion: number;
    statusChangedAt: string;
    terminal: boolean;
  };
  revision: { id: string; artifactId: string; revision: number; status: string } | null;
};

type StatusRequest = (path: string, init: RequestInit) => Promise<Response>;

const terminalStatuses = new Set(["succeeded", "failed", "needs_clarification", "cancelled"]);

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  const error = new Error(payload.error ? `${payload.error}${payload.code ? ` · ${payload.code}` : ""}` : `状态请求失败（${response.status}）`);
  Object.defineProperty(error, "status", { value: response.status, enumerable: false });
  return error;
}

function normalizeSnapshot(payload: unknown): GenerationJobStatusSnapshot {
  if (!payload || typeof payload !== "object" || !("job" in payload)) throw new Error("状态响应缺少 Generation Job");
  const value = payload as { job: GenerationJobStatusSnapshot["job"] & { statusVersion?: number }; revision?: GenerationJobStatusSnapshot["revision"] };
  const statusVersion = Number(value.job.statusVersion);
  return {
    job: {
      ...value.job,
      statusVersion: Number.isSafeInteger(statusVersion) ? statusVersion : 0,
      terminal: Boolean(value.job.terminal) || terminalStatuses.has(value.job.status)
    },
    revision: value.revision ?? null
  };
}

export async function watchGenerationJob(input: {
  jobId: string;
  afterVersion?: number;
  headers?: HeadersInit;
  signal: AbortSignal;
  request: StatusRequest;
  onStatus: (snapshot: GenerationJobStatusSnapshot) => void | Promise<void>;
}): Promise<GenerationJobStatusSnapshot | null> {
  let afterVersion = Math.max(0, input.afterVersion ?? 0);
  let fallback = false;
  let retryDelay = 1_000;

  while (!input.signal.aborted) {
    try {
      const path = fallback
        ? `/api/v1/generation-jobs/${input.jobId}`
        : `/api/v1/generation-jobs/${input.jobId}/status?afterVersion=${afterVersion}&waitMs=25000`;
      const response = await input.request(path, {
        headers: input.headers,
        credentials: "include",
        cache: "no-store",
        signal: input.signal
      });
      if (input.signal.aborted) return null;
      if ((response.status === 404 || response.status === 501) && !fallback) {
        fallback = true;
        continue;
      }
      if (response.status === 204) {
        if (response.headers.get("x-langreport-generation-job-long-poll") === "disabled") await wait(900, input.signal);
        continue;
      }
      if (!response.ok) throw await responseError(response);
      const snapshot = normalizeSnapshot(await response.json());
      afterVersion = Math.max(afterVersion, snapshot.job.statusVersion);
      await input.onStatus(snapshot);
      if (snapshot.job.terminal) return snapshot;
      retryDelay = 1_000;
      if (fallback) await wait(900, input.signal);
    } catch (error) {
      if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return null;
      const status = error instanceof Error && typeof (error as Error & { status?: unknown }).status === "number"
        ? (error as Error & { status: number }).status
        : null;
      if ((fallback && status !== null) || (status !== null && status < 500)) throw error;
      const jitter = Math.floor(Math.random() * Math.min(500, retryDelay * 0.2));
      await wait(retryDelay + jitter, input.signal);
      retryDelay = Math.min(15_000, retryDelay * 2);
    }
  }
  return null;
}
