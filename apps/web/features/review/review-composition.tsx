"use client";

import { ReviewPanel, type ReviewComment, type ReviewRevision } from "./review-panel";

export type ReviewCompositionProps = {
  revision: ReviewRevision | null;
  comments: ReviewComment[];
  note: string;
  isLoading: boolean;
  isSaving: boolean;
  onNoteChange: (value: string) => void;
  onRefresh: () => void;
  onAddComment: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
};

export function ReviewComposition({
  revision,
  comments,
  note,
  isLoading,
  isSaving,
  onNoteChange,
  onRefresh,
  onAddComment,
  onApprove,
  onRequestChanges
}: ReviewCompositionProps) {
  if (!revision || revision.status !== "in_review") return null;

  return <ReviewPanel
    revision={revision}
    comments={comments}
    note={note}
    isLoading={isLoading}
    isSaving={isSaving}
    onNoteChange={onNoteChange}
    onRefresh={onRefresh}
    onAddComment={onAddComment}
    onApprove={onApprove}
    onRequestChanges={onRequestChanges}
  />;
}
