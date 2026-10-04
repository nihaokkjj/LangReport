import { z } from "zod";

const a1Range = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}:[A-Z]{1,3}[1-9]\d{0,6}$/);
export const tableAgentDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("inspect_sheet"), sheetId: z.string().min(1).max(100), range: a1Range.nullable() })
    .strict(),
  z
    .object({
      action: z.literal("select_table"),
      sheetId: z.string().min(1).max(100),
      range: a1Range,
      reason: z.string().min(1).max(500),
    })
    .strict(),
  z.object({ action: z.literal("clarify"), question: z.string().min(1).max(500) }).strict(),
]);
export type TableAgentDecision = z.infer<typeof tableAgentDecisionSchema>;
export const tableAgentJsonSchema = z.toJSONSchema(tableAgentDecisionSchema, { target: "draft-07", io: "input" });

export const tableIntakeStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "needs_clarification"]);
export type TableIntakeStatus = z.infer<typeof tableIntakeStatusSchema>;
export const tableIntakeJobDtoSchema = z
  .object({
    id: z.uuid(),
    assetId: z.uuid(),
    status: tableIntakeStatusSchema,
    snapshotId: z.uuid().nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .strict();
