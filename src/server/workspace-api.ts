import type { Workspace } from "../workspace/service.js";
import type { ApiRequest, ApiResponse } from "./api.js";

/** 不依赖已选作品的入口，空工作区也能列出和新建作品。 */
export function workspaceApi(
  workspace: Workspace,
  req: ApiRequest,
): ApiResponse | null {
  if (req.path === "/api/providers" && req.method === "GET")
    return { status: 200, body: workspace.providers.view() };
  if (req.path === "/api/providers" && req.method === "POST") {
    try {
      const body = req.body as {
        action?: string;
        id?: string;
        profile?: unknown;
      } | null;
      if (body?.action === "copyEnvironment")
        workspace.providers.copyEnvironment();
      else if (body?.action === "save")
        workspace.providers.upsert(body.profile);
      else if (body?.action === "select" && typeof body.id === "string")
        workspace.providers.select(body.id);
      else if (body?.action === "delete" && typeof body.id === "string")
        workspace.providers.remove(body.id);
      else throw new Error("无效的供应商操作");
      return { status: 200, body: workspace.providers.view() };
    } catch (e) {
      return { status: 400, body: { error: (e as Error).message } };
    }
  }
  if (req.path === "/api/workspace" && req.method === "GET") {
    return {
      status: 200,
      body: {
        projects: workspace.list(),
        defaultProjectId: workspace.defaultProjectId,
        removed: workspace.listRemoved(),
        credits: workspace.credits(),
      },
    };
  }
  if (req.path === "/api/works" && req.method === "POST") {
    return { status: 201, body: workspace.create(req.body) };
  }
  if (req.path === "/api/works/delete" && req.method === "POST") {
    return { status: 200, body: workspace.remove(req.body) };
  }
  if (req.path === "/api/works/restore" && req.method === "POST") {
    return { status: 200, body: workspace.restore(req.body) };
  }
  return null;
}
