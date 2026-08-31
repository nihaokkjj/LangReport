import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { pasteDataRequestSchema } from "@langreport/contracts";
import { db, members, projectMembers, projects, workspaces } from "@langreport/db";
import { DataAssetError, getDataAsset, inferSourceType, ingestDataAsset, listDataAssets } from "./data-assets.js";

const DEV_USER_ID = "local-dev-user";
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function userIdFromRequest(request: { headers: Record<string, string | string[] | undefined> }): string {
  const value = request.headers["x-user-id"];
  return typeof value === "string" && value.trim() ? value.trim() : DEV_USER_ID;
}

function assertProjectId(projectId: string): void {
  if (!projectIdPattern.test(projectId)) throw new DataAssetError("项目 ID 无效");
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/dev/bootstrap", async (request, reply) => {
    const userId = userIdFromRequest(request);
    const workspaceName = "LangReport Local";
    const projectName = "销售分析 Demo";

    let [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.name, workspaceName))
      .limit(1);

    if (!workspace) {
      [workspace] = await db.insert(workspaces).values({ name: workspaceName }).returning();
      await db.insert(members).values({
        workspaceId: workspace.id,
        userId,
        role: "owner"
      });
    } else {
      await db.insert(members).values({
        workspaceId: workspace.id,
        userId,
        role: "member"
      }).onConflictDoNothing();
    }

    let [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, "sales-demo")))
      .limit(1);

    if (!project) {
      [project] = await db.insert(projects).values({
        workspaceId: workspace.id,
        name: projectName,
        slug: "sales-demo"
      }).returning();
    }

    await db.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: "editor"
    }).onConflictDoNothing();

    return reply.send({ workspace, project });
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      return reply.send({ assets: await listDataAssets(request.params.projectId) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets/upload", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const part = await request.file();
      if (!part) return reply.code(400).send({ error: "请上传文件" });
      const bytes = await part.toBuffer();
      if (part.file.truncated) return reply.code(413).send({ error: "文件不能超过 50 MB" });

      const asset = await ingestDataAsset({
        projectId: request.params.projectId,
        createdBy: userIdFromRequest(request),
        name: part.filename,
        sourceType: inferSourceType(part.filename, part.mimetype),
        mimeType: part.mimetype,
        bytes
      });
      return reply.code(201).send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets/paste", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = pasteDataRequestSchema.parse(request.body);
      const asset = await ingestDataAsset({
        projectId: request.params.projectId,
        createdBy: userIdFromRequest(request),
        name: body.name,
        sourceType: "pasted",
        mimeType: "text/csv",
        bytes: Buffer.from(body.content, "utf8")
      });
      return reply.code(201).send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { assetId: string } }>("/api/v1/data-assets/:assetId", async (request, reply) => {
    try {
      return reply.send({ asset: await getDataAsset(request.params.assetId) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });
}

function sendDataError(reply: FastifyReply, error: unknown) {
  if (error instanceof DataAssetError || error instanceof Error && error.name === "DataParseError") {
    return reply.code(400).send({ error: error.message });
  }
  return reply.code(500).send({ error: "数据处理失败" });
}
