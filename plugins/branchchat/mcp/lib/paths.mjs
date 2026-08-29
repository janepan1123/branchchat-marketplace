import { access, readdir, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export function branchChatPaths(env = process.env, home = os.homedir()) {
  const root = path.resolve(env.BRANCHCHAT_HOME || path.join(home, ".branchchat"));
  return {
    root,
    stateFile: path.resolve(env.BRANCHCHAT_STATE_PATH || path.join(root, "state.json")),
    worktreesRoot: path.resolve(env.BRANCHCHAT_WORKTREES_ROOT || path.join(root, "worktrees")),
    locksRoot: path.join(root, "locks"),
    logsRoot: path.join(root, "logs"),
    logFile: path.join(root, "logs", "branchchat.log"),
  };
}

export async function canonicalExistingPath(value) {
  return path.resolve(await realpath(path.resolve(value)));
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function repoIdFor(repoRoot) {
  return `repo_${createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 12)}`;
}

export function newTaskId() {
  return `task_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function slugify(value, fallback = "task") {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export function defaultBranchName(taskTitle, taskId) {
  const suffix = taskId.replace(/^task_/, "").slice(0, 8);
  const slug = slugify(taskTitle, `task-${suffix}`);
  return `branchchat/${slug}`;
}

export function taskWorktreePath(paths, repoId, taskId) {
  return path.join(paths.worktreesRoot, repoId, taskId);
}

async function executable(value) {
  try {
    await access(value, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findCodexExecutable(env = process.env, home = os.homedir()) {
  if (env.BRANCHCHAT_CODEX_PATH && await executable(env.BRANCHCHAT_CODEX_PATH)) {
    return path.resolve(env.BRANCHCHAT_CODEX_PATH);
  }

  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "codex");
    if (await executable(candidate)) return candidate;
  }

  const fixed = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(home, ".volta", "bin", "codex"),
    path.join(home, ".local", "bin", "codex"),
  ];
  for (const candidate of fixed) {
    if (await executable(candidate)) return candidate;
  }

  const nvmRoot = path.join(home, ".nvm", "versions", "node");
  try {
    const versions = (await readdir(nvmRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(nvmRoot, version, "bin", "codex");
      if (await executable(candidate)) return candidate;
    }
  } catch {
    // The nvm directory is optional.
  }

  return null;
}
