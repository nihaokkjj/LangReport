"use client";

export type ReviewComment = { id: string; authorId: string; body: string; resolvedAt: string | null; createdAt: string };
export type ReviewRevisionStatus = "draft" | "in_review" | "approved" | "changes_requested" | "archived";
export type ReviewRevision = { revision: number; status: ReviewRevisionStatus; validation: { valid: boolean } };

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function ReviewPanel({ revision, comments, note, isLoading, isSaving, onNoteChange, onRefresh, onAddComment, onApprove, onRequestChanges }: { revision: ReviewRevision; comments: ReviewComment[]; note: string; isLoading: boolean; isSaving: boolean; onNoteChange: (value: string) => void; onRefresh: () => void; onAddComment: () => void; onApprove: () => void; onRequestChanges: () => void }) {
  const unresolvedComments = comments.filter((comment) => !comment.resolvedAt).length;
  return <section className="review-panel" aria-label="审核与评论">
    <div className="review-panel-head"><div><div className="eyebrow">审核 / R{revision.revision}</div><h2>审核前检查</h2><p>确认图表、口径、来源和结论都能被客户复核。</p></div><span className={`review-count ${unresolvedComments ? "has-comments" : ""}`}>{unresolvedComments} 条未解决评论</span></div>
    <div className="review-checklist"><span className={revision.validation.valid ? "pass" : "fail"}>{revision.validation.valid ? "✓" : "!"} 自动校验{revision.validation.valid ? "已通过" : "存在问题"}</span><span className="pass">✓ 数据快照已固定</span><span className="pass">✓ Approved 后只读</span></div>
    <div className="review-comments-head"><strong>评论</strong><button type="button" className="text-button" onClick={onRefresh} disabled={isLoading}>{isLoading ? "读取中" : "刷新评论"}</button></div>
    {comments.length === 0 ? <p className="review-empty">暂无评论。审核意见会保留在当前 Revision。</p> : <div className="review-comments">{comments.map((comment) => <article className={`review-comment ${comment.resolvedAt ? "resolved" : ""}`} key={comment.id}><div><strong>{comment.authorId}</strong><time>{formatDate(comment.createdAt)}</time></div><p>{comment.body}</p>{comment.resolvedAt && <small>已解决</small>}</article>)}</div>}
    <label className="field-label review-note-field"><span>审核意见</span><textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="指出需要修改的内容，或记录批准依据。" /></label>
    <div className="review-panel-actions"><button type="button" className="secondary-button" onClick={onAddComment} disabled={!note.trim() || isSaving}>{isSaving ? "保存中" : "添加评论"}</button><button type="button" className="secondary-button" onClick={onRequestChanges} disabled={!note.trim()}>提交修改请求</button><button type="button" className="primary-button" onClick={onApprove}>批准此版本</button></div>
  </section>;
}
