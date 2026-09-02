import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { BranchChatError } from "./errors.mjs";
import { withFileLock } from "./locks.mjs";

export function emptyState() {
  return { schemaVersion: 1, repos: {}, tasks: {} };
}

export function validateState(value) {
  if (!value || value.schemaVersion !== 1 || !plainObject(value.repos) || !plainObject(value.tasks)) {
    throw new BranchChatError("STATE_CORRUPT", "BranchChat state is invalid; no changes were made.", {
      recoverable: false,
    });
  }
  for (const [id, repo] of Object.entries(value.repos)) {
    if (!repo || repo.id !== id || typeof repo.root !== "string") {
      throw new BranchChatError("STATE_CORRUPT", `Invalid repository record '${id}'.`, { recoverable: false });
    }
  }
  for (const [id, task] of Object.entries(value.tasks)) {
    const required = ["id", "repoId", "title", "sourceThreadId", "baseRef", "baseSha", "branch", "worktreePath", "status"];
    if (!task || task.id !== id || required.some((key) => typeof task[key] !== "string")) {
      throw new BranchChatError("STATE_CORRUPT", `Invalid task record '${id}'.`, { recoverable: false });
    }
    if (task.managedWorktreesRoot !== undefined && typeof task.managedWorktreesRoot !== "string") {
      throw new BranchChatError("STATE_CORRUPT", `Invalid managed worktree root for task '${id}'.`, { recoverable: false });
    }
    if (task.projectId !== undefined && task.projectId !== null && typeof task.projectId !== "string") {
      throw new BranchChatError("STATE_CORRUPT", `Invalid Codex project for task '${id}'.`, { recoverable: false });
    }
  }
  return value;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export class StateStore {
  constructor(paths) { this.paths = paths; }

  async read() {
    let text;
    try { text = await readFile(this.paths.stateFile, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw error;
    }
    try { return validateState(JSON.parse(text)); }
    catch (error) {
      if (error instanceof BranchChatError) throw error;
      throw new BranchChatError("STATE_CORRUPT", "BranchChat state is not valid JSON; no changes were made.", {
        recoverable: false, cause: error,
      });
    }
  }

  async write(state) {
    validateState(state);
    await mkdir(path.dirname(this.paths.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.paths.stateFile}.${process.pid}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, this.paths.stateFile);
    const directory = await open(path.dirname(this.paths.stateFile), "r").catch(() => null);
    try { await directory?.sync(); } finally { await directory?.close(); }
  }

  async mutate(operation) {
    return withFileLock(this.paths.locksRoot, "state", async () => {
      const state = await this.read();
      const result = await operation(state);
      await this.write(state);
      return result;
    });
  }
}
