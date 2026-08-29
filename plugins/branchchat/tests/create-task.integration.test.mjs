import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "../mcp/lib/git.mjs";
import { branchChatPaths } from "../mcp/lib/paths.mjs";
import { StateStore } from "../mcp/lib/state.mjs";
import { TaskService } from "../mcp/lib/task-service.mjs";

class FakeAppServer {
  constructor(cwd, { failTitles = false, failFork = false } = {}) {
    this.cwd = cwd;
    this.failTitles = failTitles;
    this.failFork = failFork;
    this.forks = [];
  }
  async threadRead(threadId) { return { id: threadId, cwd: this.cwd, name: "Source" }; }
  async forkThread(sourceThreadId, cwd) {
    if (this.failFork) throw new Error("fork unavailable");
    const thread = { id: `child-${this.forks.length + 1}`, cwd, sourceThreadId };
    this.forks.push(thread);
    return thread;
  }
  async setThreadName() { if (this.failTitles) throw new Error("no rollout found"); }
  async updateThreadMetadata() {}
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "branchchat-create-"));
  const repo = path.join(root, "repo");
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(["init", "-b", "main", repo]);
  await git(["-C", repo, "config", "user.email", "branchchat@example.invalid"]);
  await git(["-C", repo, "config", "user.name", "BranchChat Tests"]);
  await writeFile(path.join(repo, "shared.txt"), "base\n");
  await git(["-C", repo, "add", "shared.txt"]);
  await git(["-C", repo, "commit", "-m", "base"]);
  const paths = branchChatPaths({ BRANCHCHAT_HOME: path.join(root, "home") }, root);
  return { root, repo, paths };
}

test("two conversations get independent branches and worktrees from one base", async (t) => {
  const { repo, paths } = await fixture(t);
  const appServer = new FakeAppServer(repo);
  const service = new TaskService({ paths, store: new StateStore(paths), appServer, platform: "linux" });
  const first = await service.createTask({ taskTitle: "Frontend", branchName: "feature/frontend", openAfterCreate: false }, { threadId: "source" });
  const second = await service.createTask({ taskTitle: "Backend", branchName: "feature/backend", openAfterCreate: false }, { threadId: "source" });
  assert.notEqual(first.task.worktreePath, second.task.worktreePath);
  assert.equal(first.task.baseSha, second.task.baseSha);
  await appendFile(path.join(first.task.worktreePath, "shared.txt"), "frontend\n");
  await appendFile(path.join(second.task.worktreePath, "shared.txt"), "backend\n");
  assert.match(await readFile(path.join(first.task.worktreePath, "shared.txt"), "utf8"), /frontend/);
  assert.doesNotMatch(await readFile(path.join(first.task.worktreePath, "shared.txt"), "utf8"), /backend/);
  assert.equal(await readFile(path.join(repo, "shared.txt"), "utf8"), "base\n");
});

test("fork failure safely removes an untouched worktree and branch", async (t) => {
  const { repo, paths } = await fixture(t);
  const service = new TaskService({
    paths,
    store: new StateStore(paths),
    appServer: new FakeAppServer(repo, { failFork: true }),
    platform: "linux",
  });
  await assert.rejects(
    service.createTask({ taskTitle: "Rollback", branchName: "feature/rollback", openAfterCreate: false }, { threadId: "source" }),
    (error) => error.code === "THREAD_FORK_FAILED",
  );
  const branches = await git(["-C", repo, "branch", "--format=%(refname:short)"]);
  assert.doesNotMatch(branches.stdout, /feature\/rollback/);
  assert.deepEqual((await new StateStore(paths).read()).tasks, {});
});

test("title failure is non-fatal and persisted for retry", async (t) => {
  const { repo, paths } = await fixture(t);
  const service = new TaskService({
    paths,
    store: new StateStore(paths),
    appServer: new FakeAppServer(repo, { failTitles: true }),
    platform: "linux",
  });
  const result = await service.createTask({ taskTitle: "Retry Title", openAfterCreate: false }, { threadId: "source" });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /retried/);
  const task = (await new StateStore(paths).read()).tasks[result.task.id];
  assert.equal(task.status, "ACTIVE");
  assert.equal(task.pendingTitleSync, true);
});
