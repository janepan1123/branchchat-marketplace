#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppServerClient } from "./lib/app-server-client.mjs";
import { errorResult } from "./lib/errors.mjs";
import { Logger } from "./lib/logger.mjs";
import { branchChatPaths } from "./lib/paths.mjs";
import { StateStore } from "./lib/state.mjs";
import { TaskService } from "./lib/task-service.mjs";

const taskSelector = {
  type: "string",
  description: "Task ID, exact title, full branch, short branch, or 'current'.",
};

export const tools = [
  {
    name: "branchchat_create_task",
    description: "Create and open an isolated Git task, or open the existing BranchChat task when that branch is already managed.",
    inputSchema: {
      type: "object",
      properties: {
        taskTitle: { type: "string", minLength: 1, description: "Human-readable task title." },
        branchName: { type: "string", minLength: 1, description: "Optional valid new Git branch name." },
        baseRef: { type: "string", minLength: 1, description: "Optional Git ref used as the frozen starting commit. When omitted, BranchChat detects the remote default branch, then the current worktree branch." },
        openAfterCreate: { type: "boolean", default: true, description: "Try to open the created or existing Codex task on macOS." },
      },
      required: ["taskTitle"],
      additionalProperties: false,
    },
  },
  {
    name: "branchchat_list_tasks",
    description: "List BranchChat-managed tasks, preferring the current Git repository.",
    inputSchema: {
      type: "object",
      properties: { includeArchived: { type: "boolean", default: false } },
      additionalProperties: false,
    },
  },
  {
    name: "branchchat_switch_task",
    description: "Validate and open a managed Codex task without changing the current Git checkout.",
    inputSchema: {
      type: "object",
      properties: { task: taskSelector },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "branchchat_status",
    description: "Read Git/worktree/title status for a BranchChat task.",
    inputSchema: {
      type: "object",
      properties: { task: { ...taskSelector, default: "current" } },
      additionalProperties: false,
    },
  },
  {
    name: "branchchat_sync",
    description: "Synchronize task title and metadata after validating the stored Git mapping.",
    inputSchema: {
      type: "object",
      properties: { task: { ...taskSelector, default: "current" } },
      additionalProperties: false,
    },
  },
  {
    name: "branchchat_finish_inspect",
    description: "Inspect readiness and provide a merge command; never merge or delete anything.",
    inputSchema: {
      type: "object",
      properties: { task: { ...taskSelector, default: "current" } },
      additionalProperties: false,
    },
  },
];

export function createBranchChatServer({ paths = branchChatPaths(), appServer } = {}) {
  const logger = new Logger(paths);
  const codex = appServer || new AppServerClient();
  const service = new TaskService({ paths, store: new StateStore(paths), appServer: codex, logger });
  const server = new Server(
    { name: "branchchat", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments || {};
    const meta = request.params._meta || request._meta || {};
    let result;
    try {
      switch (request.params.name) {
        case "branchchat_create_task": result = await service.createTask(args, meta); break;
        case "branchchat_list_tasks": result = await service.listTasks(args, meta); break;
        case "branchchat_switch_task": result = await service.switchTask(args, meta); break;
        case "branchchat_status": result = await service.status(args, meta); break;
        case "branchchat_sync": result = await service.sync(args, meta); break;
        case "branchchat_finish_inspect": result = await service.finishInspect(args, meta); break;
        default: result = errorResult(new Error(`Unknown tool: ${request.params.name}`));
      }
    } catch (error) {
      result = errorResult(error);
      await logger.error("tool-failed", { tool: request.params.name, code: result.error.code });
    }
    return {
      isError: !result.ok,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  });
  return { server, appServer: codex };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, appServer } = createBranchChatServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = async () => {
    appServer.close?.();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
