/** A minimal fetch contract so the Harness remains independent of provider SDKs. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type JsonRecord = Record<string, unknown>;

export type StructuredModelTransportRequest = {
  url: string;
  headers: Record<string, string>;
  body: JsonRecord;
  signal: AbortSignal;
  deadlineAt: number;
};

export type StructuredModelTransportResult =
  | { kind: "response"; status: number; ok: boolean; payload: JsonRecord }
  | { kind: "timeout" }
  | { kind: "cancelled" }
  | { kind: "transport_error"; message: string };

/**
 * Send one JSON request with a bounded deadline. This layer normalizes only
 * transport outcomes; provider and application semantics stay with its caller.
 */
export async function sendStructuredModelRequest(
  request: StructuredModelTransportRequest,
  fetcher: FetchLike = fetch,
  now: () => number = Date.now
): Promise<StructuredModelTransportResult> {
  if (request.signal.aborted) return { kind: "cancelled" };
  const remainingMs = request.deadlineAt - now();
  if (remainingMs <= 0) return { kind: "timeout" };

  const controller = new AbortController();
  let outcome: "timeout" | "cancelled" | undefined;
  const cancel = () => {
    outcome = "cancelled";
    controller.abort(request.signal.reason);
  };
  request.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    outcome = "timeout";
    controller.abort(new Error("structured model request deadline exceeded"));
  }, remainingMs);

  try {
    const response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
    return {
      kind: "response",
      status: response.status,
      ok: response.ok,
      payload: await jsonPayload(response)
    };
  } catch (error) {
    if (outcome) return { kind: outcome };
    return { kind: "transport_error", message: errorMessage(error) };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
  }
}

async function jsonPayload(response: Response): Promise<JsonRecord> {
  try {
    return asRecord(await response.json()) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.slice(0, 500) : "request failed";
}
