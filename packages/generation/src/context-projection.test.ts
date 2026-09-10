import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CANONICAL_TEXT_MESSAGE_LENGTH,
  MAX_CANONICAL_TEXT_MESSAGES,
  projectConversationToCanonicalTextContext,
  validateCanonicalTextContextProjection
} from "./context-projection.js";

test("canonical_text_context 保留规范角色和顺序，并生成稳定哈希", () => {
  const messages = [
    { role: "user" as const, content: "  比较华东和华南\r\n销售额  " },
    { role: "assistant" as const, content: "已记录。" }
  ];
  const first = projectConversationToCanonicalTextContext(messages);
  const second = projectConversationToCanonicalTextContext(messages);

  assert.deepEqual(first.messages, [
    { role: "user", content: "比较华东和华南\n销售额" },
    { role: "assistant", content: "已记录。" }
  ]);
  assert.equal(first.version, "canonical-text-context-v1");
  assert.match(first.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(validateCanonicalTextContextProjection(first), first);
});

test("canonical_text_context 仅保留最近消息，并把截断事实写入投影和哈希", () => {
  const messages = Array.from({ length: MAX_CANONICAL_TEXT_MESSAGES + 2 }, (_, index) => ({
    role: "user" as const,
    content: index === MAX_CANONICAL_TEXT_MESSAGES + 1 ? "x".repeat(MAX_CANONICAL_TEXT_MESSAGE_LENGTH + 40) : `消息 ${index}`
  }));
  const projection = projectConversationToCanonicalTextContext(messages);
  const changed = projectConversationToCanonicalTextContext(messages.map((message, index) => index === messages.length - 1
    ? { ...message, content: `changed-${message.content}` }
    : message));

  assert.equal(projection.messages.length, MAX_CANONICAL_TEXT_MESSAGES);
  assert.equal(projection.messages[0]?.content, "消息 2");
  assert.equal(projection.omittedMessageCount, 2);
  assert.equal(projection.truncatedMessageCount, 1);
  assert.equal(projection.messages.at(-1)?.content.length, MAX_CANONICAL_TEXT_MESSAGE_LENGTH);
  assert.notEqual(projection.hash, changed.hash);
  assert.throws(() => validateCanonicalTextContextProjection({ ...projection, hash: `sha256:${"0".repeat(64)}` }), /哈希不匹配/);
});
