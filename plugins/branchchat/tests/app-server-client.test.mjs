import test from "node:test";
import assert from "node:assert/strict";
import { AppServerClient } from "../mcp/lib/app-server-client.mjs";

class RecordingAppServerClient extends AppServerClient {
  async request(method, params) {
    this.recorded = { method, params };
    return { thread: { id: "child", cwd: params.cwd } };
  }
}

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
