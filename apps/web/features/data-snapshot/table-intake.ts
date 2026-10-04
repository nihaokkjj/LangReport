import { apiFetch } from "../../lib/http-client";

type IntakeJob = {
  id: string;
  assetId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "needs_clarification";
  snapshotId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export async function waitForTableIntake(projectId: string, jobId: string, signal: AbortSignal): Promise<IntakeJob> {
  const deadline = Date.now() + 10 * 60_000;
  while (!signal.aborted && Date.now() < deadline) {
    const { job } = await apiFetch<{ job: IntakeJob }>(`/api/v1/projects/${projectId}/data-intake-jobs/${jobId}`, {
      signal,
    });
    if (job.status === "succeeded") return job;
    if (job.status === "failed" || job.status === "needs_clarification")
      throw new Error(job.errorMessage ?? "表格识别失败，请补充工作表或表头说明后重试");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("已停止等待", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error(signal.aborted ? "已停止等待，后台接入任务会继续执行" : "后台仍在处理，请稍后刷新数据列表查看结果");
}
