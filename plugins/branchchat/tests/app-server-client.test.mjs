import test from "node:test";
import assert from "node:assert/strict";
import { AppServerClient, appServerInitializeParams } from "../mcp/lib/app-server-client.mjs";

class RecordingAppServerClient extends AppServerClient {
  async request(method, params) {
    this.recorded = { method, params };
    return { thread: { id: "child", cwd: params.cwd } };
  }
}

test("BranchChat opts into the experimental App Server API", () => {
  assert.deepEqual(appServerInitializeParams(), {
    clientInfo: { name: "branchchat", title: "BranchChat", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
});

test("forkThread excludes the active turn and replaces the runtime workspace", async () => {
  const client = new RecordingAppServerClient();
  const result = await client.forkThread("source", "/projects/repo-worktrees/task", {
    beforeTurnId: "turn-active",
  });
  assert.equal(result.id, "child");
  assert.deepEqual(client.recorded, {
    method: "thread/fork",
    params: {
      threadId: "source",
      cwd: "/projects/repo-worktrees/task",
      runtimeWorkspaceRoots: ["/projects/repo-worktrees/task"],
      excludeTurns: true,
      beforeTurnId: "turn-active",
    },
  });
});
