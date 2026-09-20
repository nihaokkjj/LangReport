import { createDatabaseChannelListener } from "@langreport/db";

const STATUS_CHANNEL = "langreport_generation_job_status";
const DEFAULT_WAIT_MS = 25_000;

type Logger = {
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

type Waiter = {
  jobId: string;
  afterVersion: number;
  resolve: (changed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function parseNotification(payload: string): { jobId: string; version: number } | null {
  const separator = payload.lastIndexOf(":");
  if (separator <= 0) return null;
  const jobId = payload.slice(0, separator);
  const version = Number(payload.slice(separator + 1));
  return jobId && Number.isSafeInteger(version) ? { jobId, version } : null;
}

export function createGenerationJobStatusObserver(logger?: Logger): {
  waitForChange(input: { jobId: string; afterVersion: number; waitMs?: number; signal?: AbortSignal }): Promise<boolean>;
  close(): Promise<void>;
} {
  const waiters = new Set<Waiter>();
  let listenerPromise: Promise<(() => Promise<void>) | undefined> | undefined;
  let closed = false;

  const finish = (waiter: Waiter, changed: boolean) => {
    if (!waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve(changed);
  };

  const onNotification = (payload: string) => {
    const notification = parseNotification(payload);
    if (!notification) return;
    for (const waiter of [...waiters]) {
      if (waiter.jobId === notification.jobId && notification.version > waiter.afterVersion) finish(waiter, true);
    }
  };

  const ensureListener = async (): Promise<void> => {
    if (closed || listenerPromise) return listenerPromise ? await listenerPromise.then(() => undefined) : undefined;
    listenerPromise = createDatabaseChannelListener(STATUS_CHANNEL, onNotification).catch((error) => {
      logger?.warn({ err: error }, "Generation Job 状态通知监听不可用，将由 HTTP 超时兜底");
      listenerPromise = undefined;
      return undefined;
    });
    await listenerPromise;
  };

  return {
    async waitForChange({ jobId, afterVersion, waitMs = DEFAULT_WAIT_MS, signal }) {
      if (closed || signal?.aborted) return false;
      const timeout = Math.max(1, Math.min(DEFAULT_WAIT_MS, Math.floor(waitMs)));
      return new Promise<boolean>((resolve) => {
        const waiter: Waiter = {
          jobId,
          afterVersion,
          resolve,
          timer: setTimeout(() => finish(waiter, false), timeout),
          signal
        };
        waiter.onAbort = () => finish(waiter, false);
        waiters.add(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        void ensureListener();
      });
    },
    async close() {
      closed = true;
      for (const waiter of [...waiters]) finish(waiter, false);
      const unlisten = await listenerPromise;
      if (unlisten) {
        try {
          await unlisten();
        } catch (error) {
          logger?.error({ err: error }, "关闭 Generation Job 状态通知监听失败");
        }
      }
      listenerPromise = undefined;
    }
  };
}
