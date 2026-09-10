import { createHash } from "node:crypto";
import {
  canonicalTextContextProjectionSchema,
  type CanonicalTextContextMessage,
  type CanonicalTextContextProjection
} from "@langreport/contracts";

export const CANONICAL_TEXT_CONTEXT_VERSION = "canonical-text-context-v1" as const;
export const MAX_CANONICAL_TEXT_MESSAGES = 12;
export const MAX_CANONICAL_TEXT_MESSAGE_LENGTH = 2_000;

export type ConversationMessageForProjection = {
  role: CanonicalTextContextMessage["role"];
  content: string;
};

/**
 * Convert ordered, platform-owned Conversation messages into the only history
 * representation allowed to cross the first model boundary. The projection is
 * intentionally free of database identity and provider-specific fields.
 */
export function projectConversationToCanonicalTextContext(
  messages: ConversationMessageForProjection[]
): CanonicalTextContextProjection {
  const normalized = messages.map((message) => ({
    role: message.role,
    ...canonicalizeMessageContent(message.content)
  }));
  const recent = normalized.slice(-MAX_CANONICAL_TEXT_MESSAGES);
  const projection = {
    version: CANONICAL_TEXT_CONTEXT_VERSION,
    messages: recent.map(({ role, content }) => ({ role, content })),
    omittedMessageCount: normalized.length - recent.length,
    truncatedMessageCount: recent.filter((message) => message.truncated).length
  };
  const hash = hashCanonicalTextContextProjection(projection);
  return canonicalTextContextProjectionSchema.parse({ ...projection, hash });
}

/** Reject a stored projection if its declared hash no longer matches its content. */
export function validateCanonicalTextContextProjection(input: unknown): CanonicalTextContextProjection {
  const projection = canonicalTextContextProjectionSchema.parse(input);
  const expectedHash = hashCanonicalTextContextProjection(projection);
  if (projection.hash !== expectedHash) throw new Error("Conversation 上下文投影哈希不匹配");
  return projection;
}

function canonicalizeMessageContent(content: string): { content: string; truncated: boolean } {
  const normalized = content.replace(/\r\n?/g, "\n").trim().normalize("NFC");
  if (normalized.length === 0) throw new Error("Conversation 消息不能为空");
  if (normalized.length <= MAX_CANONICAL_TEXT_MESSAGE_LENGTH) return { content: normalized, truncated: false };
  const suffix = "\n[truncated]";
  return {
    content: `${normalized.slice(0, MAX_CANONICAL_TEXT_MESSAGE_LENGTH - suffix.length)}${suffix}`,
    truncated: true
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) return nestedValue;
    return Object.fromEntries(Object.entries(nestedValue).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function hashCanonicalTextContextProjection(input: Omit<CanonicalTextContextProjection, "hash"> | CanonicalTextContextProjection): string {
  const { version, messages, omittedMessageCount, truncatedMessageCount } = input;
  return `sha256:${createHash("sha256").update(stableJson({ version, messages, omittedMessageCount, truncatedMessageCount })).digest("hex")}`;
}
