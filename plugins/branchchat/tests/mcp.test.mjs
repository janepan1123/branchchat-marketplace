import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server publishes the six BranchChat tools", async () => {
  const pluginRoot = process.env.BRANCHCHAT_RUNTIME_ROOT
    ? path.resolve(process.env.BRANCHCHAT_RUNTIME_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const transport = new StdioClientTransport({
    command: "/bin/bash",
    args: [path.join(pluginRoot, "scripts", "run-server.sh")],
    cwd: pluginRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "branchchat-bundle-tests", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
      "branchchat_create_task",
      "branchchat_finish_inspect",
      "branchchat_list_tasks",
      "branchchat_status",
      "branchchat_switch_task",
      "branchchat_sync",
    ]);
  } finally { await client.close(); }
});
