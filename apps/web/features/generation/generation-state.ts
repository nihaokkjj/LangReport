export type GenerationPhase =
  | "idle"
  | "watching"
  | "refreshing-result"
  | "complete"
  | "needs-clarification"
  | "failed"
  | "cancelled";

export type GenerationState = { phase: GenerationPhase; error: string | null };

export type GenerationEvent =
  | { type: "watching" }
  | { type: "refreshing-result" }
  | { type: "terminal"; status: string }
  | { type: "error"; message: string }
  | { type: "reset" };

export const initialGenerationState: GenerationState = { phase: "idle", error: null };

export function generationReducer(state: GenerationState, event: GenerationEvent): GenerationState {
  switch (event.type) {
    case "watching":
      return { phase: "watching", error: null };
    case "refreshing-result":
      return { phase: "refreshing-result", error: null };
    case "terminal":
      return {
        phase: event.status === "succeeded" ? "complete" : event.status === "needs_clarification" ? "needs-clarification" : event.status === "cancelled" ? "cancelled" : "failed",
        error: event.status === "failed" ? "生成任务失败" : null
      };
    case "error":
      return { phase: "failed", error: event.message };
    case "reset":
      return initialGenerationState;
    default:
      return state;
  }
}
