"use client";

import AddIcon from "@mui/icons-material/Add";
import { Button, IconButton, InputBase, Menu, MenuItem } from "@mui/material";
import { useRef, type RefObject } from "react";
import ChevronDownIcon from "@mui/icons-material/ExpandMore";

type Conversation = { id: string; title: string; updatedAt: string };
type ConversationMessage = { id: string; role: "user" | "assistant" | "system"; content: string; createdAt: string };
type EvidenceSummary = { block: { conversationId: string }; revision: { revision: number; status: string } };

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

type ConversationSelectorProps = {
  conversation: Conversation | null;
  conversations: Conversation[];
  conversationId: string | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
};

export function ConversationSelector({
  conversation,
  conversations,
  conversationId,
  menuOpen,
  onToggleMenu,
  onSelect,
  onCreate,
}: ConversationSelectorProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="selector conversation-selector">
      <Button
        ref={anchorRef}
        type="button"
        className="selector-button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={onToggleMenu}
      >
        <span className="selector-icon">C</span>
        <span className="selector-copy">
          <span className="eyebrow">对话</span>
          <strong>{conversation?.title ?? "新的分析对话"}</strong>
          <small>{conversations.length} 条记录</small>
        </span>
        <span className="selector-chevron">
          <ChevronDownIcon />
        </span>
      </Button>
      <Menu
        open={menuOpen}
        anchorEl={anchorRef.current}
        onClose={onToggleMenu}
        slotProps={{ paper: { sx: { width: 340, maxWidth: "calc(100vw - 32px)" } } }}
      >
        {conversations.map((item) => (
          <MenuItem
            key={item.id}
            selected={item.id === conversationId}
            onClick={() => onSelect(item.id)}
            sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 2, minHeight: 48 }}
          >
            <strong>{item.title}</strong>
            <small>{formatDate(item.updatedAt)}</small>
          </MenuItem>
        ))}
        <MenuItem onClick={onCreate}>＋ 新建对话</MenuItem>
      </Menu>
    </div>
  );
}

type ConversationHistoryRailProps = {
  conversations: Conversation[];
  evidence: EvidenceSummary[];
  conversationId: string | null;
  isLoading: boolean;
  revisionLabels: Record<string, string>;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
};

export function ConversationHistoryRail({
  conversations,
  evidence,
  conversationId,
  isLoading,
  revisionLabels,
  onSelect,
  onCreate,
}: ConversationHistoryRailProps) {
  return (
    <>
      <div className="rail-head">
        <div>
          <div className="eyebrow">历史</div>
          <h2>对话</h2>
        </div>
        <IconButton aria-label="新建对话" onClick={onCreate}>
          <AddIcon fontSize="small" />
        </IconButton>
      </div>
      <div className="history-list">
        {isLoading ? (
          <div className="rail-empty">载入中</div>
        ) : conversations.length === 0 ? (
          <div className="rail-empty">—</div>
        ) : (
          conversations.map((item) => {
            const conversationEvidence = evidence.find((record) => record.block.conversationId === item.id);
            return (
              <Button
                type="button"
                key={item.id}
                className={`history-item ${item.id === conversationId ? "current" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                <strong>{item.title}</strong>
                <small>
                  {conversationEvidence
                    ? `R${conversationEvidence.revision.revision} · ${revisionLabels[conversationEvidence.revision.status] ?? conversationEvidence.revision.status}`
                    : "暂无版本"}
                </small>
                <span className="history-meta">
                  <span>{formatDate(item.updatedAt)}</span>
                  <span>↗</span>
                </span>
              </Button>
            );
          })
        )}
      </div>
    </>
  );
}

type ConversationComposerProps = {
  messages: ConversationMessage[];
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  isSending: boolean;
  isJobActive: boolean;
  jobStatus?: string;
  statusLabels: Record<string, string>;
  hasSnapshot: boolean;
  hasMetric: boolean;
  hasBrief: boolean;
  snapshotVersion: number | null;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onPrompt: (value: string) => void;
};

export function ConversationComposer({
  messages,
  composer,
  composerRef,
  isSending,
  isJobActive,
  jobStatus,
  statusLabels,
  hasSnapshot,
  hasMetric,
  hasBrief,
  snapshotVersion,
  onComposerChange,
  onSend,
  onPrompt,
}: ConversationComposerProps) {
  const isGenerateAction = hasSnapshot && hasMetric && hasBrief;
  return (
    <>
      {messages.length > 0 && (
        <details className="conversation-log">
          <summary>
            <span className="eyebrow">对话</span>
            <strong>{messages.length} 条消息</strong>
            <span className="conversation-chevron">
              <ChevronDownIcon />
            </span>
          </summary>
          <div className="conversation-messages">
            {messages.map((message) => (
              <div
                className={`conversation-message ${message.role === "user" ? "from-user" : "from-system"}`}
                key={message.id}
              >
                <span>{message.role === "user" ? "我" : "AI"}</span>
                <p>{message.content}</p>
                <time>{formatDate(message.createdAt)}</time>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="composer-wrap">
        <div className="composer">
          <InputBase
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            inputRef={composerRef}
            value={composer}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void onSend();
            }}
            aria-label="继续对话"
            placeholder="输入问题，先讨论也可以…"
            disabled={isSending || isJobActive}
          />
          <div className="composer-bottom">
            <div className="composer-meta">
              <span>{snapshotVersion !== null ? `数据快照 v${snapshotVersion}` : "暂无快照"}</span>
              <span>{hasMetric ? "指标已确认" : "指标待确认"}</span>
            </div>
            <div className="composer-actions">
              <Button
                type="button"
                variant="contained"
                className={`composer-send ${isGenerateAction ? "composer-generate" : ""}`}
                onClick={onSend}
                disabled={!composer.trim() || isSending || isJobActive}
              >
                {isSending
                  ? "提交中"
                  : isJobActive
                    ? `${statusLabels[jobStatus ?? "queued"] ?? jobStatus ?? "处理中"}…`
                    : isGenerateAction
                      ? "生成证据 ↗"
                      : "提交问题 ↗"}
              </Button>
            </div>
          </div>
          <div className="prompt-row">
            <Button
              type="button"
              variant="text"
              className="prompt-chip"
              onClick={() => onPrompt("按月份展示各区域销售额")}
            >
              区域销售 / 月度
            </Button>
            <Button type="button" variant="text" className="prompt-chip" onClick={() => onPrompt("对比各区域同比变化")}>
              区域同比
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
