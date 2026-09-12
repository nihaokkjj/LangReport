import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createEvidenceGenerationNodes } from "./nodes.js";
import { afterCompile, afterPlan, afterPrepare, afterRepair, afterTransform, afterValidate } from "./routes.js";
import type { EvidenceGenerationGraphPort, EvidenceGenerationGraphState } from "./state.js";

const State = Annotation.Root({
  audit: Annotation<unknown>, decision: Annotation<EvidenceGenerationGraphState["decision"]>, transformPlan: Annotation<EvidenceGenerationGraphState["transformPlan"]>,
  compiledFlintSpec: Annotation<EvidenceGenerationGraphState["compiledFlintSpec"]>, validation: Annotation<EvidenceGenerationGraphState["validation"]>,
  repairCount: Annotation<number>({ default: () => 0, reducer: (_current, next) => next }), terminal: Annotation<EvidenceGenerationGraphState["terminal"]>,
  questions: Annotation<EvidenceGenerationGraphState["questions"]>, failure: Annotation<EvidenceGenerationGraphState["failure"]>
});

export async function runEvidenceGenerationGraph(port: EvidenceGenerationGraphPort): Promise<EvidenceGenerationGraphState> {
  const nodes = createEvidenceGenerationNodes(port);
  const graph = new StateGraph(State)
    .addNode("prepare", nodes.prepare).addNode("plan", nodes.plan).addNode("transform", nodes.transform)
    .addNode("compile", nodes.compile).addNode("validate", nodes.validate).addNode("repair", nodes.repair)
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", afterPrepare, { plan: "plan", end: END })
    .addConditionalEdges("plan", afterPlan, { transform: "transform", end: END })
    .addConditionalEdges("transform", afterTransform, { compile: "compile", end: END })
    .addConditionalEdges("compile", afterCompile, { validate: "validate", end: END })
    .addConditionalEdges("validate", afterValidate, { repair: "repair", end: END })
    .addConditionalEdges("repair", afterRepair, { transform: "transform", end: END })
    .compile({ checkpointer: false });
  return graph.invoke({ repairCount: 0 }) as Promise<EvidenceGenerationGraphState>;
}
