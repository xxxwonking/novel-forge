import type { Workspace } from "../workspace/service.js";
import type { ApiRequest, ApiResponse } from "./api.js";

/** 不依赖已选作品的入口，空工作区也能列出和新建作品。 */
export function workspaceApi(workspace: Workspace, req: ApiRequest): ApiResponse | null {
  if (req.path === "/api/workspace" && req.method === "GET") {
    return { status: 200, body: { projects: workspace.list(), defaultProjectId: workspace.defaultProjectId } };
  }
  if (req.path === "/api/works" && req.method === "POST") {
    return { status: 201, body: workspace.create(req.body) };
  }
  return null;
}
