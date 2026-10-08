"use client";

import { Alert, Button, Chip, TextField } from "@mui/material";

export type ReviewComment = {
  id: string;
  authorId: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
};
export type ReviewRevisionStatus = "draft" | "in_review" | "approved" | "changes_requested" | "archived";
export type ReviewRevision = {
  revision: number;
  status: ReviewRevisionStatus;
  validation: { valid: boolean };
  integrityStatus?: "legacy_unverified" | "verified";
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ReviewPanel({
  revision,
  comments,
  note,
  isLoading,
  isSaving,
  onNoteChange,
  onRefresh,
  onAddComment,
  onApprove,
  onRequestChanges,
}: {
  revision: ReviewRevision;
  comments: ReviewComment[];
  note: string;
  isLoading: boolean;
  isSaving: boolean;
  onNoteChange: (value: string) => void;
  onRefresh: () => void;
  onAddComment: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const unresolvedComments = comments.filter((comment) => !comment.resolvedAt).length;
  return (
    <section className="review-panel" aria-label="审核与评论">
      <div className="review-panel-head">
        <div>
          <div className="eyebrow">审核 / R{revision.revision}</div>
          <h2>审核前检查</h2>
          <p>确认图表、口径、来源和结论都能被客户复核。</p>
        </div>
        <Chip label={`${unresolvedComments} 条未解决评论`} color={unresolvedComments ? "warning" : "default"} />
      </div>
      <div className="review-checklist">
        <Alert severity={revision.validation.valid ? "success" : "error"}>
          自动校验{revision.validation.valid ? "已通过" : "存在问题"}
        </Alert>
        <Alert severity={revision.integrityStatus === "legacy_unverified" ? "warning" : "success"}>
          {revision.integrityStatus === "legacy_unverified" ? "历史版本未验证，请重新确认输入并生成" : "数据快照已固定"}
        </Alert>
        <Alert severity="success">Approved 后只读</Alert>
      </div>
      <div className="review-comments-head">
        <strong>评论</strong>
        <Button variant="text" type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "读取中" : "刷新评论"}
        </Button>
      </div>
      {comments.length === 0 ? (
        <p className="review-empty">暂无评论。审核意见会保留在当前 Revision。</p>
      ) : (
        <div className="review-comments">
          {comments.map((comment) => (
            <article className={`review-comment ${comment.resolvedAt ? "resolved" : ""}`} key={comment.id}>
              <div>
                <strong>{comment.authorId}</strong>
                <time>{formatDate(comment.createdAt)}</time>
              </div>
              <p>{comment.body}</p>
              {comment.resolvedAt && <small>已解决</small>}
            </article>
          ))}
        </div>
      )}
      <label className="field-label review-note-field">
        <span>审核意见</span>
        <TextField
          multiline
          minRows={3}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="指出需要修改的内容，或记录批准依据。"
        />
      </label>
      <div className="review-panel-actions">
        <Button variant="outlined" type="button" onClick={onAddComment} disabled={!note.trim() || isSaving}>
          {isSaving ? "保存中" : "添加评论"}
        </Button>
        <Button
          variant="outlined"
          type="button"
          onClick={onRequestChanges}
          disabled={!note.trim() || revision.integrityStatus === "legacy_unverified"}
        >
          提交修改请求
        </Button>
        <Button
          variant="contained"
          type="button"
          onClick={onApprove}
          disabled={revision.integrityStatus === "legacy_unverified"}
        >
          批准此版本
        </Button>
      </div>
    </section>
  );
}
