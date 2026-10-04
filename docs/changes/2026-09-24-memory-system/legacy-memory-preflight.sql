-- Run only against an isolated copy or an operator-approved dry-run snapshot.
-- Do not run this script against production as part of the current A batch.

-- These rows block 0029 because a migration must not choose a current head.
SELECT
  scope,
  workspace_id,
  project_id,
  memory_key,
  array_agg(id ORDER BY version, created_at) AS memory_version_ids,
  array_agg(version ORDER BY version, created_at) AS versions
FROM memories
WHERE status = 'active'
GROUP BY workspace_id, scope, project_id, memory_key
HAVING count(*) > 1
ORDER BY scope, workspace_id, project_id, memory_key;

-- These rows block 0029 because two legacy rows cannot share one logical version.
SELECT
  scope,
  workspace_id,
  project_id,
  memory_key,
  version,
  array_agg(id ORDER BY created_at) AS duplicate_memory_ids
FROM memories
GROUP BY workspace_id, scope, project_id, memory_key, version
HAVING count(*) > 1
ORDER BY scope, workspace_id, project_id, memory_key, version;

-- NULL means the old row has no trustworthy confirmation timestamp.
-- Do not substitute created_at for confirmed_at.
SELECT scope, count(*) AS active_rows_without_confirmation_time
FROM memories
WHERE status = 'active'
  AND (source_candidate_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM memory_candidates candidate
    WHERE candidate.id = memories.source_candidate_id
      AND candidate.status = 'accepted'
      AND candidate.reviewed_at IS NOT NULL
  ))
GROUP BY scope
ORDER BY scope;

-- Workspace rows are retained; the A-batch app paths must not read or mutate them.
SELECT count(*) AS retained_workspace_memory_rows
FROM memories
WHERE scope = 'workspace';
