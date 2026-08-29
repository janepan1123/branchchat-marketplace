import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { branchChatPaths } from "../mcp/lib/paths.mjs";
import { StateStore } from "../mcp/lib/state.mjs";

test("StateStore writes atomically and rejects corrupt state", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "branchchat-state-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = branchChatPaths({ BRANCHCHAT_HOME: home }, home);
  const store = new StateStore(paths);
  await store.mutate((state) => {
    state.repos.repo_test = { id: "repo_test", root: "/tmp/repo", defaultBranch: "main" };
  });
  const written = JSON.parse(await readFile(paths.stateFile, "utf8"));
  assert.equal(written.repos.repo_test.root, "/tmp/repo");
  await writeFile(paths.stateFile, "{broken");
  await assert.rejects(store.read(), (error) => error.code === "STATE_CORRUPT");
});
