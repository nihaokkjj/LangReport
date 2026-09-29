import { expect, test } from "@playwright/test";
import { captureUiEvidence } from "./visual-evidence";

const workspaceId = "workspace-e2e";
const projectId = "project-e2e";
const pluginId = "plugin-e2e";
const installationId = "installation-e2e";
const contentHash = "sha256:e2e";
const manifest = {
  apiVersion: "langreport.dev/v1",
  kind: "ChartPlugin",
  metadata: { id: pluginId, version: "1.0.0", name: "验收插件" },
  compatibility: { flintAdapter: ">=0.1 <0.2", renderers: ["vega-lite"] },
  templates: [],
  themes: [{ id: "palette-warm", name: "暖色主题" }],
  semanticTypes: [],
  validators: [],
  examples: [],
};

test("插件安装、项目启停、Manifest 校验和显式主题选择", async ({ page }) => {
  let installed = false;
  let enabled = false;
  let bindingVersion = 0;
  let themeVersion = 1;
  let themeRef: Record<string, unknown> | null = null;
  let validationRequests = 0;
  let themeRequests = 0;
  const installation = {
    id: installationId,
    workspaceId,
    pluginId,
    version: "1.0.0",
    contentHash,
    status: "installed",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const record = { installation, manifest: { id: pluginId, name: "验收插件", description: null, manifest } };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/v1/auth/session")
      return json({
        authenticated: true,
        userId: "e2e-user",
        username: "e2e-user",
        expiresAt: "2026-10-04T00:00:00.000Z",
      });
    if (path === "/api/v1/projects")
      return json({
        workspace: { id: workspaceId, name: "验收工作区" },
        projects: [{ id: projectId, name: "验收项目" }],
      });
    if (path === `/api/v1/workspaces/${workspaceId}/plugin-catalog`)
      return json({
        plugins: [
          {
            pluginId,
            version: "1.0.0",
            name: "验收插件",
            description: null,
            contentHash,
            manifest,
            compatibility: manifest.compatibility,
            capabilities: [{ kind: "theme", id: "palette-warm", capabilityKey: "theme:palette-warm" }],
          },
        ],
      });
    if (path === `/api/v1/workspaces/${workspaceId}/plugins` && method === "GET")
      return json({ plugins: installed ? [record] : [] });
    if (path === `/api/v1/workspaces/${workspaceId}/plugins` && method === "POST") {
      installed = true;
      return json({ reused: false }, 201);
    }
    if (path === `/api/v1/workspaces/${workspaceId}/plugins/validate` && method === "POST") {
      validationRequests += 1;
      return json({ validationReport: { valid: true, issues: [] } });
    }
    if (path === `/api/v1/projects/${projectId}/plugins` && method === "GET")
      return json({
        plugins:
          installed && bindingVersion
            ? [
                {
                  binding: {
                    id: "binding-e2e",
                    installationId,
                    pluginId,
                    version: "1.0.0",
                    status: enabled ? "enabled" : "disabled",
                    versionNumber: bindingVersion,
                  },
                  installation,
                  manifest: record.manifest,
                },
              ]
            : [],
      });
    if (path === `/api/v1/projects/${projectId}/plugins/${installationId}` && method === "PUT") {
      const body = request.postDataJSON() as { enabled: boolean; expectedVersion?: number };
      expect(body.expectedVersion).toBe(bindingVersion || undefined);
      enabled = body.enabled;
      bindingVersion += 1;
      return json({ binding: { status: enabled ? "enabled" : "disabled", versionNumber: bindingVersion } });
    }
    if (path === `/api/v1/projects/${projectId}/capabilities`)
      return json({
        context: { themeRef },
        manifests: enabled
          ? [
              {
                pluginId,
                version: "1.0.0",
                contentHash,
                capabilities: [{ kind: "theme", id: "palette-warm", pluginId, version: "1.0.0", contentHash }],
              },
            ]
          : [],
      });
    if (path === `/api/v1/projects/${projectId}/theme` && method === "GET")
      return json({ theme: { preset: "consulting-neutral", themeRef, version: themeVersion, config: {} } });
    if (path === `/api/v1/projects/${projectId}/theme` && method === "PUT") {
      const body = request.postDataJSON() as { themeRef: Record<string, unknown>; expectedVersion: number };
      expect(body.expectedVersion).toBe(themeVersion);
      themeRef = body.themeRef;
      themeVersion += 1;
      themeRequests += 1;
      return json({ theme: { preset: "consulting-neutral", themeRef, version: themeVersion, config: {} } });
    }
    return json({ error: `unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/plugins");
  await expect(page.getByRole("heading", { name: "插件", exact: true })).toBeVisible();
  await captureUiEvidence(page, "plugins");
  await page.getByRole("button", { name: "加入可用能力" }).click();
  await expect(page.getByRole("button", { name: "启用到项目" })).toBeVisible();
  await page.getByRole("button", { name: "启用到项目" }).click();
  await expect(page.getByRole("button", { name: "已启用 · 停用" })).toBeVisible();

  await page.getByRole("textbox", { name: "Manifest JSON" }).fill(JSON.stringify(manifest));
  await page.getByRole("button", { name: "校验 Manifest" }).click();
  await expect(page.getByText("Manifest 校验通过，可以安装。")).toBeVisible();
  expect(validationRequests).toBe(1);

  await page.getByRole("button", { name: /palette-warm/ }).click();
  await expect(page.getByText("主题已切换为 palette-warm，下一次生成会固化该主题快照。")).toBeVisible();
  expect(themeRequests).toBe(1);
  expect(themeRef).toMatchObject({ source: "plugin", pluginId, capabilityId: "palette-warm", contentHash });

  await page.getByRole("button", { name: "已启用 · 停用" }).click();
  await expect(page.getByRole("button", { name: "启用到项目" })).toBeVisible();
  expect(enabled).toBe(false);
});
