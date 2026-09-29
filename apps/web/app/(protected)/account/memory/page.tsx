"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from "@mui/material";
import { apiFetch, formatApiError, jsonHeaders } from "../../../../lib/http-client";
import styles from "./memory.module.css";

type Project = { id: string; name: string };
type ProjectMemory = {
  id: string;
  logicalMemoryId: string;
  memoryKey: string;
  memoryType: "metric_definition" | "data_definition" | "business_rule" | "terminology" | "visual_preference";
  statement: string;
  value: Record<string, unknown>;
  version: number;
  status: "active" | "superseded" | "deleted";
  conflictStatus: "clear" | "disputed";
  confirmedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};
type Preference = {
  id: string;
  logicalMemoryId: string;
  category: "language" | "tone" | "detail" | "interaction" | "output_format";
  memoryKey: string;
  statement: string;
  value: Record<string, unknown>;
  version: number;
  status: "active" | "superseded";
  confirmedAt: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};
type ProjectMemoryContext = { memory: { project: ProjectMemory[] } };
type ProjectMemoryHistory = { versions: ProjectMemory[] };
type PreferencesPayload = { preferences: Preference[] };
type ProjectsPayload = { projects: Project[] };
type PreferenceUsage = {
  id: string;
  generationJobId: string;
  invocationId: string;
  preferences: Preference[];
  status: string;
  admittedAt: string;
  completedAt: string | null;
};
type ProjectUsage = {
  id: string;
  generationJobId: string;
  invocationId: string;
  memories: ProjectMemory[];
  status: string;
  admittedAt: string;
  completedAt: string | null;
};
type DeleteTarget =
  { kind: "preference"; record: Preference } | { kind: "project-memory"; record: ProjectMemory; projectId: string };

const memoryTypes: Array<{ value: ProjectMemory["memoryType"]; label: string }> = [
  { value: "business_rule", label: "业务规则" },
  { value: "metric_definition", label: "指标定义" },
  { value: "data_definition", label: "数据定义" },
  { value: "terminology", label: "术语" },
  { value: "visual_preference", label: "视觉偏好" },
];

const categories: Array<{ value: Preference["category"]; label: string }> = [
  { value: "language", label: "语言" },
  { value: "tone", label: "语气" },
  { value: "detail", label: "详细程度" },
  { value: "interaction", label: "交互习惯" },
  { value: "output_format", label: "输出格式" },
];

function formatDate(value: string | null): string {
  if (!value) return "时间未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未记录"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorText(error: unknown): string {
  return formatApiError(error, "记忆操作失败，请刷新后重试。");
}

export default function MemorySettingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preferenceCategory, setPreferenceCategory] = useState<Preference["category"]>("language");
  const [preferenceStatement, setPreferenceStatement] = useState("");
  const [projectMemoryKey, setProjectMemoryKey] = useState("");
  const [projectMemoryType, setProjectMemoryType] = useState<ProjectMemory["memoryType"]>("business_rule");
  const [projectMemoryStatement, setProjectMemoryStatement] = useState("");
  const [editingPreferenceId, setEditingPreferenceId] = useState<string | null>(null);
  const [editingPreferenceStatement, setEditingPreferenceStatement] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryStatement, setEditingMemoryStatement] = useState("");
  const [historyMemoryId, setHistoryMemoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectMemory[]>([]);
  const [asOfInput, setAsOfInput] = useState("");
  const [asOfResult, setAsOfResult] = useState<ProjectMemory | null | undefined>(undefined);
  const [preferenceUsage, setPreferenceUsage] = useState<PreferenceUsage[]>([]);
  const [projectUsage, setProjectUsage] = useState<ProjectUsage[]>([]);
  const [showPreferenceUsage, setShowPreferenceUsage] = useState(false);
  const [showProjectUsage, setShowProjectUsage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    let current = true;
    setIsLoading(true);
    setPageError(null);
    void Promise.all([
      apiFetch<ProjectsPayload>("/api/v1/projects"),
      apiFetch<PreferencesPayload>("/api/v1/me/preferences"),
    ])
      .then(([projectPayload, preferencePayload]) => {
        if (!current) return;
        setProjects(projectPayload.projects);
        setPreferences(preferencePayload.preferences);
        setProjectId((existing) =>
          projectPayload.projects.some((project) => project.id === existing)
            ? existing
            : (projectPayload.projects[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (current) setPageError(errorText(error));
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!projectId) {
      setProjectMemories([]);
      setIsProjectLoading(false);
      return;
    }
    let current = true;
    setIsProjectLoading(true);
    setActionError(null);
    void apiFetch<ProjectMemoryContext>(`/api/v1/projects/${encodeURIComponent(projectId)}/memories`)
      .then((payload) => {
        if (current) setProjectMemories(payload.memory.project);
      })
      .catch((error: unknown) => {
        if (current) setActionError(errorText(error));
      })
      .finally(() => {
        if (current) setIsProjectLoading(false);
      });
    return () => {
      current = false;
    };
  }, [projectId, reloadKey]);

  function refresh() {
    setActionError(null);
    setReloadKey((value) => value + 1);
  }

  async function submitPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsMutating(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/me/preferences", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          category: availablePreferenceCategory,
          statement: preferenceStatement.trim(),
          value: {},
        }),
      });
      setPreferenceStatement("");
      setNotice("个人偏好已保存，只对当前账号可见。");
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function savePreference(preference: Preference) {
    if (!editingPreferenceStatement.trim()) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/me/preferences/${encodeURIComponent(preference.id)}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({
          expectedVersion: preference.version,
          statement: editingPreferenceStatement.trim(),
          value: preference.value,
        }),
      });
      setEditingPreferenceId(null);
      setNotice("个人偏好已创建新版本。");
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function deletePreference(preference: Preference) {
    if (isMutating) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/me/preferences/${encodeURIComponent(preference.id)}`, {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({ expectedVersion: preference.version }),
      });
      setNotice("个人偏好及其历史正文已清除。");
      setDeleteTarget(null);
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function submitProjectMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/memories`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          memoryKey: projectMemoryKey.trim(),
          memoryType: projectMemoryType,
          statement: projectMemoryStatement.trim(),
          value: {},
          sourceMessageIds: [],
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setProjectMemoryKey("");
      setProjectMemoryStatement("");
      setNotice("Project Memory 已确认并保存为新记录。");
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function saveProjectMemory(memory: ProjectMemory) {
    if (!projectId || !editingMemoryStatement.trim()) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memory.id)}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({
          expectedVersion: memory.version,
          statement: editingMemoryStatement.trim(),
          value: memory.value,
        }),
      });
      setEditingMemoryId(null);
      setNotice("Project Memory 已创建新版本。");
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function changeConflict(memory: ProjectMemory) {
    if (!projectId) return;
    const conflictStatus = memory.conflictStatus === "disputed" ? "clear" : "disputed";
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memory.id)}/conflict`,
        {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ expectedVersion: memory.version, conflictStatus }),
        },
      );
      setNotice(conflictStatus === "disputed" ? "已标记为待处理冲突。" : "冲突标记已解除。");
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteProjectMemory(memory: ProjectMemory, targetProjectId: string) {
    if (isMutating) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await apiFetch(
        `/api/v1/projects/${encodeURIComponent(targetProjectId)}/memories/${encodeURIComponent(memory.id)}`,
        {
          method: "DELETE",
          headers: jsonHeaders,
          body: JSON.stringify({ expectedVersion: memory.version }),
        },
      );
      setNotice("Project Memory 已撤销，旧来源不会重新激活它。");
      setDeleteTarget(null);
      refresh();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || isMutating) return;
    if (deleteTarget.kind === "preference") {
      await deletePreference(deleteTarget.record);
    } else {
      await deleteProjectMemory(deleteTarget.record, deleteTarget.projectId);
    }
  }

  async function toggleHistory(memory: ProjectMemory) {
    if (!projectId) return;
    if (historyMemoryId === memory.logicalMemoryId) {
      setHistoryMemoryId(null);
      setHistory([]);
      setAsOfResult(undefined);
      return;
    }
    setHistoryMemoryId(memory.logicalMemoryId);
    setActionError(null);
    try {
      const payload = await apiFetch<ProjectMemoryHistory>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memory.logicalMemoryId)}/history`,
      );
      setHistory(payload.versions);
    } catch (error) {
      setActionError(errorText(error));
      setHistoryMemoryId(null);
    }
  }

  async function queryAsOf(memory: ProjectMemory) {
    if (!projectId || !asOfInput) return;
    setActionError(null);
    try {
      const effectiveAt = new Date(asOfInput);
      if (Number.isNaN(effectiveAt.getTime())) throw new Error("请输入有效的有效时间。");
      const query = new URLSearchParams({ effectiveAt: effectiveAt.toISOString() });
      const payload = await apiFetch<{ memory: ProjectMemory | null }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memory.logicalMemoryId)}/as-of?${query.toString()}`,
      );
      setAsOfResult(payload.memory);
    } catch (error) {
      setActionError(errorText(error));
    }
  }

  async function togglePreferenceUsage() {
    if (showPreferenceUsage) {
      setShowPreferenceUsage(false);
      return;
    }
    setActionError(null);
    try {
      const payload = await apiFetch<{ usage: PreferenceUsage[] }>("/api/v1/me/memory-usage");
      setPreferenceUsage(payload.usage);
      setShowPreferenceUsage(true);
    } catch (error) {
      setActionError(errorText(error));
    }
  }

  async function toggleProjectUsage() {
    if (showProjectUsage) {
      setShowProjectUsage(false);
      return;
    }
    if (!projectId) return;
    setActionError(null);
    try {
      const payload = await apiFetch<{ usage: ProjectUsage[] }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/memory-usage`,
      );
      setProjectUsage(payload.usage);
      setShowProjectUsage(true);
    } catch (error) {
      setActionError(errorText(error));
    }
  }

  const unusedCategories = categories.filter(
    (category) => !preferences.some((preference) => preference.category === category.value),
  );
  const availablePreferenceCategory = unusedCategories.some((category) => category.value === preferenceCategory)
    ? preferenceCategory
    : (unusedCategories[0]?.value ?? "");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          LangReport
        </Link>
        <Link className={styles.backLink} href="/account">
          返回账号设置
        </Link>
      </header>
      <div className={styles.content}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>MEMORY SETTINGS</span>
            <h1>记忆设置</h1>
          </div>
          <Button type="button" variant="outlined" onClick={refresh} disabled={isLoading || isMutating}>
            刷新
          </Button>
        </div>
        <p className={styles.intro}>
          长期记忆需要你明确确认。个人偏好与 Project Memory 分开保存；删除个人偏好会清除全部历史正文，删除 Project
          Memory 会撤销后续使用。
        </p>
        {pageError && (
          <Alert severity="error" role="alert">
            {pageError}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" role="alert">
            {actionError}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}

        <section className={styles.panel} aria-labelledby="preference-title">
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>PRIVATE · 当前账号</span>
              <h2 id="preference-title">个人偏好</h2>
            </div>
            <span className={styles.count}>{preferences.length.toString().padStart(2, "0")}</span>
          </div>
          <p className={styles.panelNote}>
            只对当前账号可见，不会出现在 Project、Generation Job 或 Revision 的共享记录中。
          </p>
          <form className={styles.createForm} onSubmit={(event) => void submitPreference(event)} aria-busy={isMutating}>
            <label className={styles.field}>
              <span>偏好类别</span>
              <TextField
                select
                value={availablePreferenceCategory}
                onChange={(event) => setPreferenceCategory(event.target.value as Preference["category"])}
                disabled={unusedCategories.length === 0 || isMutating}
              >
                {unusedCategories.length === 0 && <MenuItem value="">所有类别都已设置</MenuItem>}
                {unusedCategories.map((category) => (
                  <MenuItem key={category.value} value={category.value}>
                    {category.label}
                  </MenuItem>
                ))}
              </TextField>
            </label>
            <label className={styles.field}>
              <span>偏好内容</span>
              <TextField
                value={preferenceStatement}
                onChange={(event) => setPreferenceStatement(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
                required
                placeholder="例如：回答使用简体中文，语气简洁"
              />
            </label>
            <Button
              variant="contained"
              type="submit"
              disabled={isMutating || unusedCategories.length === 0 || !preferenceStatement.trim()}
            >
              {isMutating ? "保存中…" : "确认添加"}
            </Button>
          </form>
          {isLoading ? (
            <p className={styles.empty}>正在读取个人偏好…</p>
          ) : preferences.length === 0 ? (
            <p className={styles.empty}>还没有已确认的个人偏好。</p>
          ) : (
            <ul className={styles.records}>
              {preferences.map((preference) => (
                <li className={styles.record} key={preference.id}>
                  <div className={styles.recordBody}>
                    <div className={styles.recordMeta}>
                      <span className={styles.typeBadge}>
                        {categories.find((item) => item.value === preference.category)?.label ?? preference.category}
                      </span>
                      <span>v{preference.version}</span>
                      <span>确认于 {formatDate(preference.confirmedAt)}</span>
                    </div>
                    {editingPreferenceId === preference.id ? (
                      <div className={styles.inlineEdit}>
                        <TextField
                          value={editingPreferenceStatement}
                          onChange={(event) => setEditingPreferenceStatement(event.target.value)}
                          slotProps={{ htmlInput: { maxLength: 1000, "aria-label": "编辑个人偏好" } }}
                          sx={{ flex: "1 1 260px" }}
                        />
                        <Button
                          type="button"
                          variant="contained"
                          disabled={isMutating || !editingPreferenceStatement.trim()}
                          onClick={() => void savePreference(preference)}
                        >
                          保存新版本
                        </Button>
                        <Button type="button" variant="text" onClick={() => setEditingPreferenceId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <p className={styles.statement}>{preference.statement}</p>
                    )}
                  </div>
                  {editingPreferenceId !== preference.id && (
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => {
                          setEditingPreferenceId(preference.id);
                          setEditingPreferenceStatement(preference.statement);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="text"
                        color="error"
                        disabled={isMutating}
                        onClick={() => setDeleteTarget({ kind: "preference", record: preference })}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="text"
            sx={{ justifySelf: "start" }}
            onClick={() => void togglePreferenceUsage()}
          >
            {showPreferenceUsage ? "收起实际使用记录" : "查看个人偏好实际使用记录"}
          </Button>
          {showPreferenceUsage && (
            <div className={styles.usageList}>
              {preferenceUsage.length === 0 ? (
                <p className={styles.empty}>目前没有模型调用使用个人偏好的记录。</p>
              ) : (
                preferenceUsage.map((usage) => (
                  <div className={styles.usageRow} key={usage.id}>
                    <div className={styles.recordMeta}>
                      <span>{usage.status}</span>
                      <time>{formatDate(usage.admittedAt)}</time>
                      <code>{usage.generationJobId}</code>
                    </div>
                    {usage.preferences.length > 0 ? (
                      <p>{usage.preferences.map((preference) => preference.statement).join("；")}</p>
                    ) : (
                      <p>该调用的个人偏好正文已删除或本次未使用偏好。</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="project-memory-title">
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>PROJECT · 成员可见</span>
              <h2 id="project-memory-title">Project Memory</h2>
            </div>
            <div className={styles.projectSelect}>
              <TextField
                select
                label="选择 Project"
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setHistoryMemoryId(null);
                  setHistory([]);
                }}
                disabled={projects.length === 0 || isMutating}
              >
                {projects.map((project) => (
                  <MenuItem value={project.id} key={project.id}>
                    {project.name}
                  </MenuItem>
                ))}
                {projects.length === 0 && <MenuItem value="">没有可访问的 Project</MenuItem>}
              </TextField>
            </div>
          </div>
          <p className={styles.panelNote}>
            Project Memory 可被该项目中有权限的成员读取。确认后会作为项目长期规则；临时要求应留在当前 Task。
          </p>
          <Button
            type="button"
            variant="text"
            sx={{ justifySelf: "start" }}
            onClick={() => void toggleProjectUsage()}
            disabled={!projectId}
          >
            {showProjectUsage ? "收起实际使用记录" : "查看 Project Memory 实际使用记录"}
          </Button>
          {showProjectUsage && (
            <div className={styles.usageList}>
              {projectUsage.length === 0 ? (
                <p className={styles.empty}>当前 Project 尚无记忆使用记录。</p>
              ) : (
                projectUsage.map((usage) => (
                  <div className={styles.usageRow} key={usage.id}>
                    <div className={styles.recordMeta}>
                      <span>{usage.status}</span>
                      <time>{formatDate(usage.admittedAt)}</time>
                      <code>{usage.generationJobId}</code>
                    </div>
                    {usage.memories.length > 0 ? (
                      <p>
                        {usage.memories
                          .map((memory) => `${memory.memoryKey} · v${memory.version}: ${memory.statement}`)
                          .join("；")}
                      </p>
                    ) : (
                      <p>本次调用未使用 Project Memory。</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {projectId && (
            <form
              className={styles.createForm}
              onSubmit={(event) => void submitProjectMemory(event)}
              aria-busy={isMutating}
            >
              <label className={styles.field}>
                <span>记忆键</span>
                <TextField
                  value={projectMemoryKey}
                  onChange={(event) => setProjectMemoryKey(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 160 } }}
                  required
                  placeholder="例如：metric.revenue.tax_rule"
                />
              </label>
              <label className={styles.field}>
                <span>类别</span>
                <TextField
                  select
                  value={projectMemoryType}
                  onChange={(event) => setProjectMemoryType(event.target.value as ProjectMemory["memoryType"])}
                >
                  {memoryTypes.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </TextField>
              </label>
              <label className={`${styles.field} ${styles.wideField}`}>
                <span>已确认规则或事实</span>
                <TextField
                  value={projectMemoryStatement}
                  onChange={(event) => setProjectMemoryStatement(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                  required
                  placeholder="写入后将在本 Project 内持续生效"
                />
              </label>
              <Button
                variant="contained"
                type="submit"
                disabled={isMutating || !projectId || !projectMemoryKey.trim() || !projectMemoryStatement.trim()}
              >
                {isMutating ? "保存中…" : "确认添加"}
              </Button>
            </form>
          )}
          {!projectId ? (
            <p className={styles.empty}>没有可访问的 Project。</p>
          ) : isProjectLoading ? (
            <p className={styles.empty}>正在读取 Project Memory…</p>
          ) : projectMemories.length === 0 ? (
            <p className={styles.empty}>当前 Project 还没有已确认的长期记忆。</p>
          ) : (
            <ul className={styles.records}>
              {projectMemories.map((memory) => (
                <li className={styles.record} key={memory.id}>
                  <div className={styles.recordBody}>
                    <div className={styles.recordMeta}>
                      <span className={styles.typeBadge}>
                        {memoryTypes.find((item) => item.value === memory.memoryType)?.label ?? memory.memoryType}
                      </span>
                      <code>{memory.memoryKey}</code>
                      <span>v{memory.version}</span>
                      <span>确认于 {formatDate(memory.confirmedAt)}</span>
                      {memory.conflictStatus === "disputed" && <span className={styles.conflictBadge}>待处理冲突</span>}
                    </div>
                    {editingMemoryId === memory.id ? (
                      <div className={styles.inlineEdit}>
                        <TextField
                          value={editingMemoryStatement}
                          onChange={(event) => setEditingMemoryStatement(event.target.value)}
                          slotProps={{ htmlInput: { maxLength: 2000, "aria-label": "编辑 Project Memory" } }}
                          sx={{ flex: "1 1 260px" }}
                        />
                        <Button
                          type="button"
                          variant="contained"
                          disabled={isMutating || !editingMemoryStatement.trim()}
                          onClick={() => void saveProjectMemory(memory)}
                        >
                          保存新版本
                        </Button>
                        <Button type="button" variant="text" onClick={() => setEditingMemoryId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <p className={styles.statement}>{memory.statement}</p>
                    )}
                    {historyMemoryId === memory.logicalMemoryId && (
                      <div className={styles.history}>
                        <strong>版本历史</strong>
                        {history.length === 0 ? (
                          <span>当前记录只有一个版本，或历史仍在读取。</span>
                        ) : (
                          history.map((version) => (
                            <div className={styles.historyRow} key={version.id}>
                              <span>
                                v{version.version} ·{" "}
                                {version.status === "active"
                                  ? "当前"
                                  : version.status === "deleted"
                                    ? "已删除"
                                    : "已替代"}
                              </span>
                              <time>{formatDate(version.confirmedAt)}</time>
                              <p>{version.statement}</p>
                            </div>
                          ))
                        )}
                        <div className={styles.asOfForm}>
                          <TextField
                            label="按业务有效时间查询"
                            type="datetime-local"
                            value={asOfInput}
                            onChange={(event) => setAsOfInput(event.target.value)}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ width: "auto" }}
                          />
                          <Button
                            type="button"
                            variant="text"
                            disabled={!asOfInput}
                            onClick={() => void queryAsOf(memory)}
                          >
                            查询
                          </Button>
                        </div>
                        {asOfResult !== undefined && (
                          <p className={styles.asOfResult}>
                            {asOfResult
                              ? `当时版本 v${asOfResult.version}：${asOfResult.statement}`
                              : "该有效时间没有对应版本。"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {editingMemoryId !== memory.id && (
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => {
                          setEditingMemoryId(memory.id);
                          setEditingMemoryStatement(memory.statement);
                        }}
                      >
                        编辑
                      </Button>
                      <Button type="button" variant="text" onClick={() => void changeConflict(memory)}>
                        {memory.conflictStatus === "disputed" ? "解除冲突" : "标记冲突"}
                      </Button>
                      <Button type="button" variant="text" onClick={() => void toggleHistory(memory)}>
                        {historyMemoryId === memory.logicalMemoryId ? "收起历史" : "版本历史"}
                      </Button>
                      <Button
                        type="button"
                        variant="text"
                        color="error"
                        disabled={isMutating}
                        onClick={() =>
                          projectId && setDeleteTarget({ kind: "project-memory", record: memory, projectId })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isMutating) setDeleteTarget(null);
        }}
        aria-labelledby="memory-delete-title"
      >
        <DialogTitle id="memory-delete-title">
          {deleteTarget?.kind === "preference" ? "删除个人偏好" : "删除 Project Memory"}
        </DialogTitle>
        <DialogContent>
          <p>
            {deleteTarget?.kind === "preference"
              ? `将删除“${deleteTarget.record.statement}”及其全部历史正文和派生引用。此操作无法撤销。`
              : `将撤销“${deleteTarget?.record.statement ?? ""}”后续注入；原始对话和报告会保留。`}
          </p>
          {actionError && <Alert severity="error">{actionError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteTarget(null)} disabled={isMutating}>
            取消
          </Button>
          <Button variant="contained" color="error" onClick={() => void confirmDelete()} disabled={isMutating}>
            {isMutating ? "删除中…" : "确认删除"}
          </Button>
        </DialogActions>
      </Dialog>
    </main>
  );
}
