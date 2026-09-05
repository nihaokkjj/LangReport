import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { closeDatabase, db, members, projectMembers, projects, withAdvisoryLock, workspaces } from "@langreport/db";

config({ path: resolve(process.cwd(), "../../.env") });

const confirmation = process.env.PROVISION_CONFIRM?.trim();
const userId = process.env.PROVISION_USER_ID?.trim();
const workspaceId = process.env.PROVISION_WORKSPACE_ID?.trim();
const workspaceName = process.env.PROVISION_WORKSPACE_NAME?.trim() || "LangReport Production";
const projectName = process.env.PROVISION_PROJECT_NAME?.trim() || "咨询项目 Demo";
const projectSlug = process.env.PROVISION_PROJECT_SLUG?.trim() || slugify(projectName);
const dryRun = process.env.PROVISION_DRY_RUN === "true";

if (!dryRun && confirmation !== "I_UNDERSTAND") {
  throw new Error("生产初始化需要 PROVISION_CONFIRM=I_UNDERSTAND；可先设置 PROVISION_DRY_RUN=true 预览。");
}
if (!userId) throw new Error("PROVISION_USER_ID 必须是外部登录网关 JWT 的 sub");
if (userId.length > 200) throw new Error("PROVISION_USER_ID 不能超过 200 个字符");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)) throw new Error("PROVISION_PROJECT_SLUG 只能包含小写字母、数字和连字符");

try {
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, userId, workspaceId: workspaceId ?? null, workspaceName, projectName, projectSlug }));
  } else {
    const result = await withAdvisoryLock(`production-provision:${workspaceId ?? workspaceName}`, () => db.transaction(async (tx) => {
      const workspace = workspaceId
        ? (await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]
        : (await tx.select().from(workspaces).where(eq(workspaces.name, workspaceName)).limit(1))[0]
          ?? (await tx.insert(workspaces).values({ name: workspaceName }).returning())[0];
      if (!workspace) throw new Error(`Workspace 不存在：${workspaceId}`);

      const [existingMember] = await tx.select().from(members).where(and(eq(members.workspaceId, workspace.id), eq(members.userId, userId))).limit(1);
      if (!existingMember) {
        await tx.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
      }

      let [project] = await tx.select().from(projects).where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, projectSlug))).limit(1);
      if (!project) {
        [project] = await tx.insert(projects).values({ workspaceId: workspace.id, name: projectName, slug: projectSlug }).returning();
      }
      if (!project) throw new Error("Project 初始化失败");

      const [existingProjectMember] = await tx.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId))).limit(1);
      if (!existingProjectMember) {
        await tx.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });
      }
      return { workspace, project, workspaceMemberCreated: !existingMember, projectMemberCreated: !existingProjectMember };
    }));
    if (!result) throw new Error("另一个生产初始化正在进行，请稍后重试");
    console.log(JSON.stringify({
      workspaceId: result.workspace.id,
      projectId: result.project.id,
      userId,
      workspaceMemberCreated: result.workspaceMemberCreated,
      projectMemberCreated: result.projectMemberCreated
    }));
  }
} finally {
  await closeDatabase();
}

function slugify(value: string): string {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "consulting-project";
}
