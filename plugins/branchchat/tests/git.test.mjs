import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorktree,
  currentBranch,
  discoverRepository,
  git,
  resolveCommit,
  statusSummary,
  validateBranchName,
} from "../mcp/lib/git.mjs";

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "branchchat-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(["init", "-b", "main", root]);
  await git(["-C", root, "config", "user.email", "branchchat@example.invalid"]);
  await git(["-C", root, "config", "user.name", "BranchChat Tests"]);
  await writeFile(path.join(root, "shared.txt"), "base\n");
  await git(["-C", root, "add", "shared.txt"]);
  await git(["-C", root, "commit", "-m", "base"]);
  return root;
}

test("Git helpers create a branch-bound worktree from a frozen SHA", async (t) => {
  const root = await repository(t);
  const baseSha = await resolveCommit(root, "main");
  await validateBranchName(root, "feature/test");
  const worktree = path.join(path.dirname(root), `${path.basename(root)}-worktree`);
  t.after(() => rm(worktree, { recursive: true, force: true }));
  await createWorktree(root, worktree, "feature/test", baseSha);
  assert.equal(await currentBranch(worktree), "feature/test");
  assert.equal((await discoverRepository(worktree)).repoRoot, await realpath(root));
  assert.deepEqual(await statusSummary(worktree, baseSha), {
    dirty: false, dirtyFiles: 0, dirtyEntries: [], ahead: 0, behindBase: 0, changedFiles: [],
  });
});

test("Git branch validation rejects invalid names", async (t) => {
  const root = await repository(t);
  await assert.rejects(validateBranchName(root, "bad branch"), (error) => error.code === "INVALID_BRANCH_NAME");
});
