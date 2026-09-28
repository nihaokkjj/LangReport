import { projectConversationToCanonicalTextContext } from "@langreport/generation";
import {
  preparedModelContextSchema,
  type MemoryContext,
  type ModelGateway,
  type ModelResult,
  type ModelRouteSnapshot,
  type RuntimeModelRequest,
} from "@langreport/contracts";
import {
  admitMemoryInvocation,
  completeMemoryInvocationUsage,
  discardMemoryInvocationUsage,
  ensureMemoryRevocationReady,
  MemoryServiceError,
} from "@langreport/memory";
import { estimateBailianRequestTokenUpperBound, MAX_HARD_REQUEST_TOKEN_UPPER_BOUND } from "@langreport/model-gateway";

type GatewayIdentity = {
  ownerId: string;
  workspaceId: string;
  projectId: string;
  conversationId: string;
  generationJobId: string;
  prompt: string;
  memoryContext: MemoryContext;
};

type MemoryAdmissionPort = {
  admit: typeof admitMemoryInvocation;
  complete: typeof completeMemoryInvocationUsage;
  discard: typeof discardMemoryInvocationUsage;
};

/** Applies the final revocation and full-request budget gate at the only active Worker send seam. */
export class MemoryInvocationGateway implements ModelGateway {
  constructor(
    private readonly inner: ModelGateway,
    private readonly route: ModelRouteSnapshot,
    private readonly identity: GatewayIdentity,
    private readonly admission: MemoryAdmissionPort = {
      admit: admitMemoryInvocation,
      complete: completeMemoryInvocationUsage,
      discard: discardMemoryInvocationUsage,
    },
    private readonly assertReady: () => Promise<void> = ensureMemoryRevocationReady,
  ) {}

  async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
    await this.assertReady();
    assertRequestFitsBudget(this.route, request);
    const admitted = await this.admission.admit({
      ownerId: this.identity.ownerId,
      workspaceId: this.identity.workspaceId,
      projectId: this.identity.projectId,
      conversationId: this.identity.conversationId,
      generationJobId: this.identity.generationJobId,
      invocationId: request.invocationId,
      memoryContext: this.identity.memoryContext,
      requestContext: request.context,
    });
    let sendAttempted = false;
    let usageFinalized = false;
    try {
      const conversation = projectConversationToCanonicalTextContext([
        ...admitted.conversationMessages.map(({ role, content }) => ({ role, content })),
        { role: "user" as const, content: this.identity.prompt },
      ]);
      const context = preparedModelContextSchema.parse({ ...admitted.requestContext, conversation });
      const authorizedRequest = { ...request, context };
      assertRequestFitsBudget(this.route, authorizedRequest);
      sendAttempted = true;
      const result = await this.inner.generateStructured(authorizedRequest);
      if (
        result.status === "error" &&
        result.invocation?.httpStatus === null &&
        (result.code === "MODEL_BUDGET_EXCEEDED" || result.code === "MODEL_REQUEST_INVALID")
      ) {
        await this.admission.discard(admitted.receipt);
        usageFinalized = true;
        return result;
      }
      await this.admission.complete({
        ownerId: this.identity.ownerId,
        generationJobId: this.identity.generationJobId,
        invocationId: request.invocationId,
        status: result.status === "ok" ? "succeeded" : "failed",
      });
      usageFinalized = true;
      return result;
    } catch (error) {
      if (!usageFinalized) {
        if (sendAttempted) {
          await this.admission.complete({
            ownerId: this.identity.ownerId,
            generationJobId: this.identity.generationJobId,
            invocationId: request.invocationId,
            status: "failed",
          });
        } else await this.admission.discard(admitted.receipt);
      }
      throw error;
    }
  }
}

function assertRequestFitsBudget<T>(route: ModelRouteSnapshot, request: RuntimeModelRequest<T>): void {
  const requestTokens = estimateBailianRequestTokenUpperBound(route, request);
  const total = requestTokens + request.budget.maxOutputTokens;
  if (total > MAX_HARD_REQUEST_TOKEN_UPPER_BOUND) {
    throw new MemoryServiceError(
      "MODEL_BUDGET_EXCEEDED",
      "完整模型请求（含私有偏好、结构化合同与输出预留）超过硬预算，本次未发送",
      413,
    );
  }
}
