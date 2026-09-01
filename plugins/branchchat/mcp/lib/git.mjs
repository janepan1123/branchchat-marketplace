import { spawn } from "node:child_process";
import { access, lstat } from "node:fs/promises";
import path from "node:path";
import { BranchChatError } from "./errors.mjs";
import { canonicalExistingPath, isPathInside } from "./paths.mjs";

function run(command, args, { cwd, env = process.env, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new BranchChatError("GIT_COMMAND_FAILED", stderr.trim() || `git exited with ${code}`, {
        details: { args, cwd, exitCode: code },
      }));
    });
  });
}

export async function git(args, options = {}) {
  return run(options.gitPath || "git", args, options);
}

export async function discoverRepository(cwd, options = {}) {
  let rootResult;
  try {
    rootResult = await git(["-C", cwd, "rev-parse", "--show-toplevel"], options);
  } catch (error) {
    throw new BranchChatError("NOT_A_GIT_REPOSITORY", "The current Codex task is not inside a Git repository.", {
      details: { cwd }, cause: error,
    });
  }
  const worktreeRoot = await canonicalExistingPath(rootResult.stdout);
  const listing = await git(["-C", worktreeRoot, "worktree", "list", "--porcelain"], options);
  const firstWorktree = listing.stdout.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  const repoRoot = firstWorktree
    ? await canonicalExistingPath(firstWorktree.slice("worktree ".length))
    : worktreeRoot;
  return { repoRoot, worktreeRoot };
}

export async function resolveCommit(repoRoot, ref, options = {}) {
  try {
    return (await git(["-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`], options)).stdout;
  } catch (error) {
    throw new BranchChatError("BASE_REF_NOT_FOUND", `Base ref '${ref}' does not resolve to a commit.`, {
      details: { repoRoot, ref }, cause: error,
    });
  }
}

export async function validateBranchName(repoRoot, branch, options = {}) {
  const result = await git(["-C", repoRoot, "check-ref-format", "--branch", branch], {
    ...options,
    allowFailure: true,
  });
  if (result.code !== 0) {
    throw new BranchChatError("INVALID_BRANCH_NAME", `Invalid Git branch name: ${branch}`, {
      details: { branch, reason: result.stderr },
    });
  }
}

export async function branchExists(repoRoot, branch, options = {}) {
  const result = await git(["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    ...options,
    allowFailure: true,
  });
  return result.code === 0;
}

export async function pathExists(value) {
  try { await access(value); return true; } catch { return false; }
}

export async function createWorktree(repoRoot, worktreePath, branch, baseSha, options = {}) {
  if (await pathExists(worktreePath)) {
    throw new BranchChatError("WORKTREE_PATH_EXISTS", "The BranchChat worktree path already exists.", {
      details: { worktreePath },
    });
  }
  await git(["-C", repoRoot, "worktree", "add", "-b", branch, worktreePath, baseSha], options);
}

export async function currentBranch(worktreePath, options = {}) {
  const result = await git(["-C", worktreePath, "symbolic-ref", "--quiet", "--short", "HEAD"], {
    ...options,
    allowFailure: true,
  });
  return result.code === 0 ? result.stdout : null;
}

export async function headSha(worktreePath, options = {}) {
  return (await git(["-C", worktreePath, "rev-parse", "HEAD"], options)).stdout;
}

export async function statusSummary(worktreePath, baseSha, options = {}) {
  const [porcelain, ahead, behind, changed] = await Promise.all([
    git(["-C", worktreePath, "status", "--porcelain=v1", "-z"], options),
    git(["-C", worktreePath, "rev-list", "--count", `${baseSha}..HEAD`], options),
    git(["-C", worktreePath, "rev-list", "--count", `HEAD..${baseSha}`], options),
    git(["-C", worktreePath, "diff", "--name-only", "-z", `${baseSha}...HEAD`], options),
  ]);
  const dirtyEntries = porcelain.stdout ? porcelain.stdout.split("\0").filter(Boolean) : [];
  const changedFiles = changed.stdout ? changed.stdout.split("\0").filter(Boolean) : [];
  return {
    dirty: dirtyEntries.length > 0,
    dirtyFiles: dirtyEntries.length,
    dirtyEntries,
    ahead: Number.parseInt(ahead.stdout, 10) || 0,
    behindBase: Number.parseInt(behind.stdout, 10) || 0,
    changedFiles,
  };
}

export async function validateTaskWorktree(task, paths, options = {}) {
  // Older state records do not contain managedWorktreesRoot and remain bound to
  // the legacy ~/.branchchat/worktrees/<repo-id> location.
  const expectedParent = task.managedWorktreesRoot || path.join(paths.worktreesRoot, task.repoId);
  if (!isPathInside(expectedParent, task.worktreePath)) {
    throw new BranchChatError("MAPPING_DRIFT", "Stored worktree path is outside the managed repository directory.", {
      details: { taskId: task.id, worktreePath: task.worktreePath },
    });
  }
  let stat;
  try { stat = await lstat(task.worktreePath); } catch { stat = null; }
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new BranchChatError("MAPPING_DRIFT", "Stored worktree is missing or is not a real directory.", {
      details: { taskId: task.id, worktreePath: task.worktreePath },
    });
  }
  const actualRoot = await canonicalExistingPath((await git([
    "-C", task.worktreePath, "rev-parse", "--show-toplevel",
  ], options)).stdout);
  const expectedRoot = await canonicalExistingPath(task.worktreePath);
  const branch = await currentBranch(task.worktreePath, options);
  if (actualRoot !== expectedRoot || branch !== task.branch) {
    throw new BranchChatError("MAPPING_DRIFT", "The stored task no longer matches its Git worktree or branch.", {
      details: { taskId: task.id, expectedBranch: task.branch, actualBranch: branch, actualRoot },
    });
  }
  return { actualRoot, branch };
}

export async function rollbackFreshWorktree(repoRoot, task, options = {}) {
  if (await pathExists(task.worktreePath)) {
    const status = await statusSummary(task.worktreePath, task.baseSha, options);
    const sha = await headSha(task.worktreePath, options);
    if (status.dirty || sha !== task.baseSha) {
      throw new BranchChatError("ROLLBACK_UNSAFE", "The new worktree changed after creation; BranchChat left it intact.", {
        details: { worktreePath: task.worktreePath, dirty: status.dirty, head: sha, baseSha: task.baseSha },
      });
    }
    await git(["-C", repoRoot, "worktree", "remove", task.worktreePath], options);
  } else if (await branchExists(repoRoot, task.branch, options)) {
    const branchSha = await resolveCommit(repoRoot, task.branch, options);
    if (branchSha !== task.baseSha) {
      throw new BranchChatError("ROLLBACK_UNSAFE", "The new branch changed after creation; BranchChat left it intact.", {
        details: { branch: task.branch, branchSha, baseSha: task.baseSha },
      });
    }
  }
  if (!(await branchExists(repoRoot, task.branch, options))) {
    return { removedWorktree: true, removedBranch: true };
  }
  const deleted = await git(["-C", repoRoot, "branch", "-d", task.branch], { ...options, allowFailure: true });
  if (deleted.code !== 0) {
    throw new BranchChatError("ROLLBACK_INCOMPLETE", "Worktree was removed but the branch could not be safely deleted.", {
      details: { branch: task.branch, reason: deleted.stderr },
    });
  }
  return { removedWorktree: true, removedBranch: true };
}

export async function sourceDirty(worktreeRoot, options = {}) {
  const result = await git(["-C", worktreeRoot, "status", "--porcelain=v1", "-z"], options);
  return Boolean(result.stdout);
}
