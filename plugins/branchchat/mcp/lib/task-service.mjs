import { spawn } from "node:child_process";
import path from "node:path";
import {
  branchExists,
  createWorktree,
  discoverRepository,
  headSha,
  resolveCommit,
  rollbackFreshWorktree,
  sourceDirty,
  statusSummary,
  validateBranchName,
  validateTaskWorktree,
} from "./git.mjs";
import { BranchChatError } from "./errors.mjs";
import { withFileLock } from "./locks.mjs";
import {
  canonicalExistingPath,
  defaultBranchName,
  newTaskId,
  repoIdFor,
  taskWorktreePath,
} from "./paths.mjs";
import { threadTitle } from "./title.mjs";

const ACTIVE_STATUSES = new Set(["PREPARING", "WORKTREE_CREATED", "THREAD_CREATED", "ACTIVE", "ERROR"]);

function now() { return new Date().toISOString(); }

function threadIdOf(thread) { return thread?.id || thread?.threadId; }
function threadCwdOf(thread) { return thread?.cwd || thread?.workingDirectory || thread?.workspace?.cwd; }
function threadNameOf(thread) { return thread?.name || thread?.title || null; }
function shortBranch(branch) { return branch.includes("/") ? branch.slice(branch.lastIndexOf("/") + 1) : branch; }
function shellQuote(value) { return `'${String(value).replaceAll("'", `'\\''`)}'`; }

async function openThread(threadId, platform = process.platform) {
  if (platform !== "darwin") return false;
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/open", [`codex://threads/${encodeURIComponent(threadId)}`], {
      shell: false, stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export class TaskService {
  constructor({ paths, store, appServer, gitOptions = {}, logger, platform = process.platform }) {
    this.paths = paths;
    this.store = store;
    this.appServer = appServer;
    this.gitOptions = gitOptions;
    this.logger = logger;
    this.platform = platform;
  }

  requireThreadId(meta) {
    const threadId = meta?.threadId;
    if (!threadId || typeof threadId !== "string") {
      throw new BranchChatError("CURRENT_THREAD_UNAVAILABLE", "Codex did not provide the current task ID; BranchChat will not guess.");
    }
    return threadId;
  }

  async createTask(input, meta) {
    const sourceThreadId = this.requireThreadId(meta);
    const taskTitleValue = String(input.taskTitle || "").trim();
    if (!taskTitleValue) throw new BranchChatError("INVALID_INPUT", "taskTitle is required.");
    const baseRef = String(input.baseRef || "main").trim();
    const sourceThread = await this.appServer.threadRead(sourceThreadId);
    const sourceCwd = threadCwdOf(sourceThread);
    if (!sourceCwd) {
      throw new BranchChatError("THREAD_CWD_UNAVAILABLE", "The current Codex task has no working directory.", {
        details: { sourceThreadId },
      });
    }
    const { repoRoot, worktreeRoot } = await discoverRepository(sourceCwd, this.gitOptions);
    const repoId = repoIdFor(repoRoot);
    const taskId = newTaskId();
    const branch = String(input.branchName || defaultBranchName(taskTitleValue, taskId)).trim();
    await validateBranchName(repoRoot, branch, this.gitOptions);
    const baseSha = await resolveCommit(repoRoot, baseRef, this.gitOptions);
    const worktreePath = taskWorktreePath(this.paths, repoId, taskId);
    const createdAt = now();
    const task = {
      id: taskId,
      repoId,
      title: taskTitleValue,
      sourceThreadId,
      baseRef,
      baseSha,
      branch,
      worktreePath,
      status: "PREPARING",
      pendingTitleSync: false,
      createdAt,
      updatedAt: createdAt,
    };

    return withFileLock(this.paths.locksRoot, repoId, async () => {
      await this.store.mutate(async (state) => {
        const managed = Object.values(state.tasks).find((candidate) =>
          candidate.repoId === repoId && candidate.branch === branch && ACTIVE_STATUSES.has(candidate.status));
        if (managed) {
          throw new BranchChatError("TASK_ALREADY_EXISTS", "This branch is already managed by BranchChat.", {
            details: { taskId: managed.id, branch },
          });
        }
        if (await branchExists(repoRoot, branch, this.gitOptions)) {
          throw new BranchChatError("BRANCH_EXISTS_UNMANAGED", "The branch already exists but is not managed by BranchChat.", {
            details: { branch },
          });
        }
        state.repos[repoId] = { id: repoId, root: repoRoot, defaultBranch: baseRef };
        state.tasks[taskId] = task;
      });

      try {
        await createWorktree(repoRoot, worktreePath, branch, baseSha, this.gitOptions);
      } catch (error) {
        await this.store.mutate((state) => { delete state.tasks[taskId]; });
        throw error;
      }
      await this.#updateTask(taskId, { status: "WORKTREE_CREATED" });

      let childThread;
      try {
        childThread = await this.appServer.forkThread(sourceThreadId, worktreePath);
      } catch (error) {
        try {
          await rollbackFreshWorktree(repoRoot, task, this.gitOptions);
          await this.store.mutate((state) => { delete state.tasks[taskId]; });
        } catch (rollbackError) {
          await this.#updateTask(taskId, {
            status: "ERROR",
            error: { code: rollbackError.code || "ROLLBACK_FAILED", message: rollbackError.message },
          });
          throw new BranchChatError("CREATE_FAILED_ROLLBACK_INCOMPLETE", "Codex task creation failed and safe rollback was incomplete.", {
            details: { taskId, worktreePath, branch, originalError: error.message, rollbackError: rollbackError.message },
            cause: error,
          });
        }
        throw new BranchChatError("THREAD_FORK_FAILED", "Codex could not fork the current task; the new Git resources were rolled back.", {
          details: { sourceThreadId }, cause: error,
        });
      }

      const childThreadId = threadIdOf(childThread);
      const childCwd = threadCwdOf(childThread);
      if (!childThreadId || !childCwd || await canonicalExistingPath(childCwd) !== await canonicalExistingPath(worktreePath)) {
        await this.#updateTask(taskId, {
          status: "ERROR",
          threadId: childThreadId || null,
          error: { code: "THREAD_WORKSPACE_MISMATCH", message: "Forked task did not bind to the expected worktree." },
        });
        throw new BranchChatError("THREAD_WORKSPACE_MISMATCH", "Forked Codex task did not bind to the expected worktree; resources were kept for repair.", {
          details: { taskId, childThreadId, expectedCwd: worktreePath, actualCwd: childCwd },
        });
      }

      await this.#updateTask(taskId, { status: "THREAD_CREATED", threadId: childThreadId });
      const warnings = [];
      const desiredTitle = threadTitle(branch, taskTitleValue);
      let pendingTitleSync = false;
      try { await this.appServer.setThreadName(childThreadId, desiredTitle); }
      catch (error) {
        pendingTitleSync = true;
        warnings.push(`Task title will be retried later: ${error.message}`);
      }
      try {
        await this.appServer.updateThreadMetadata(
          childThreadId,
          { branch, sha: baseSha },
          { taskId, repoId, worktreePath },
        );
      } catch (error) { warnings.push(`Git metadata sync is unavailable: ${error.message}`); }
      if (await sourceDirty(worktreeRoot, this.gitOptions)) {
        warnings.push("Uncommitted changes in the source worktree are not included in the new task.");
      }
      const gitInfo = await statusSummary(worktreePath, baseSha, this.gitOptions);
      await this.#updateTask(taskId, {
        status: "ACTIVE",
        pendingTitleSync,
        gitInfo: { dirtyFiles: gitInfo.dirtyFiles, ahead: gitInfo.ahead, behindBase: gitInfo.behindBase },
      });
      const opened = input.openAfterCreate === false ? false : await openThread(childThreadId, this.platform);
      if (input.openAfterCreate !== false && !opened) warnings.push("Could not open the new Codex task automatically; use its task ID from the Codex task list.");
      this.logger?.info("task-created", { taskId, sourceThreadId, threadId: childThreadId, repoId });
      return {
        ok: true,
        task: {
          id: taskId,
          title: taskTitleValue,
          threadId: childThreadId,
          sourceThreadId,
          branch,
          baseSha,
          worktreePath,
          threadTitle: desiredTitle,
        },
        opened,
        warnings,
      };
    });
  }

  async listTasks(input, meta) {
    const state = await this.store.read();
    let repoId;
    if (meta?.threadId) {
      const currentTask = Object.values(state.tasks).find((task) => task.threadId === meta.threadId);
      repoId = currentTask?.repoId;
      if (!repoId) {
        try {
          const thread = await this.appServer.threadRead(meta.threadId);
          const cwd = threadCwdOf(thread);
          if (cwd) repoId = repoIdFor((await discoverRepository(cwd, this.gitOptions)).repoRoot);
        } catch { /* Listing can still return all managed repositories. */ }
      }
    }
    const includeArchived = Boolean(input.includeArchived);
    const selected = Object.values(state.tasks).filter((task) =>
      (!repoId || task.repoId === repoId) && (includeArchived || task.status !== "ARCHIVED"));
    const tasks = [];
    for (const task of selected) {
      let gitInfo = task.gitInfo || null;
      if (task.status === "ACTIVE") {
        try {
          await validateTaskWorktree(task, this.paths, this.gitOptions);
          const summary = await statusSummary(task.worktreePath, task.baseSha, this.gitOptions);
          gitInfo = { dirtyFiles: summary.dirtyFiles, ahead: summary.ahead, behindBase: summary.behindBase };
        } catch { gitInfo = { ...gitInfo, drifted: true }; }
      }
      tasks.push(this.#publicTask(task, gitInfo));
    }
    if (repoId && state.repos[repoId]) return { ok: true, repo: state.repos[repoId].root, tasks };
    const repositories = Object.values(state.repos).map((repo) => ({
      repo: repo.root,
      tasks: tasks.filter((task) => state.tasks[task.id]?.repoId === repo.id),
    })).filter((group) => group.tasks.length > 0);
    return { ok: true, repositories };
  }

  async switchTask(input, meta) {
    const task = await this.#resolveTask(input.task, meta);
    await validateTaskWorktree(task, this.paths, this.gitOptions);
    const sync = await this.#syncTask(task);
    const opened = await openThread(task.threadId, this.platform);
    return { ok: true, threadId: task.threadId, branch: task.branch, opened, warnings: sync.warnings };
  }

  async status(input, meta) {
    const task = await this.#resolveTask(input.task || "current", meta);
    let valid = true;
    let branchMatchesWorktree = true;
    try { await validateTaskWorktree(task, this.paths, this.gitOptions); }
    catch (error) {
      if (error.code !== "MAPPING_DRIFT") throw error;
      valid = false;
      branchMatchesWorktree = error.details?.actualBranch === undefined ? null : error.details.actualBranch === task.branch;
    }
    let summary = { dirtyFiles: null, ahead: null, behindBase: null };
    if (valid) summary = await statusSummary(task.worktreePath, task.baseSha, this.gitOptions);
    let titleInSync = null;
    try {
      const thread = await this.appServer.threadRead(task.threadId);
      titleInSync = threadNameOf(thread) === threadTitle(task.branch, task.title);
    } catch { /* App Server title is optional. */ }
    return {
      ok: true,
      task: task.title,
      taskId: task.id,
      branch: task.branch,
      worktreeValid: valid,
      branchMatchesWorktree,
      dirtyFiles: summary.dirtyFiles,
      ahead: summary.ahead,
      behindBase: summary.behindBase,
      titleInSync,
    };
  }

  async sync(input, meta) {
    const task = await this.#resolveTask(input.task || "current", meta);
    await validateTaskWorktree(task, this.paths, this.gitOptions);
    const result = await this.#syncTask(task);
    return { ok: true, taskId: task.id, branch: task.branch, ...result };
  }

  async finishInspect(input, meta) {
    const task = await this.#resolveTask(input.task || "current", meta);
    await validateTaskWorktree(task, this.paths, this.gitOptions);
    const summary = await statusSummary(task.worktreePath, task.baseSha, this.gitOptions);
    return {
      ok: true,
      branch: task.branch,
      base: task.baseRef,
      baseSha: task.baseSha,
      dirty: summary.dirty,
      dirtyFiles: summary.dirtyEntries,
      ahead: summary.ahead,
      changedFiles: summary.changedFiles.length,
      changedFileNames: summary.changedFiles,
      worktreePath: task.worktreePath,
      mergeCommand: `git merge --no-ff ${shellQuote(task.branch)}`,
    };
  }

  async #syncTask(task) {
    const summary = await statusSummary(task.worktreePath, task.baseSha, this.gitOptions);
    const warnings = [];
    let titleSynced = true;
    try { await this.appServer.setThreadName(task.threadId, threadTitle(task.branch, task.title)); }
    catch (error) { titleSynced = false; warnings.push(`Task title sync failed: ${error.message}`); }
    try {
      await this.appServer.updateThreadMetadata(
        task.threadId,
        { branch: task.branch, sha: await headSha(task.worktreePath, this.gitOptions) },
        { taskId: task.id, repoId: task.repoId, worktreePath: task.worktreePath },
      );
    } catch (error) { warnings.push(`Git metadata sync is unavailable: ${error.message}`); }
    const gitInfo = { dirtyFiles: summary.dirtyFiles, ahead: summary.ahead, behindBase: summary.behindBase };
    await this.#updateTask(task.id, { pendingTitleSync: !titleSynced, gitInfo });
    return { titleSynced, gitInfo, warnings };
  }

  async #resolveTask(selector, meta) {
    const state = await this.store.read();
    const tasks = Object.values(state.tasks).filter((task) => task.status !== "ARCHIVED");
    if (!selector || selector === "current") {
      const threadId = this.requireThreadId(meta);
      const task = tasks.find((candidate) => candidate.threadId === threadId);
      if (!task) throw new BranchChatError("TASK_NOT_FOUND", "The current Codex task is not managed by BranchChat.", { details: { threadId } });
      return task;
    }
    const needle = String(selector).trim().toLowerCase();
    const matches = tasks.filter((task) => [task.id, task.title, task.branch, shortBranch(task.branch)]
      .some((value) => String(value).toLowerCase() === needle));
    if (matches.length === 0) throw new BranchChatError("TASK_NOT_FOUND", `No BranchChat task matches '${selector}'.`);
    if (matches.length > 1) {
      throw new BranchChatError("AMBIGUOUS_TASK", `More than one BranchChat task matches '${selector}'.`, {
        details: { candidates: matches.map((task) => ({ id: task.id, title: task.title, branch: task.branch })) },
      });
    }
    return matches[0];
  }

  async #updateTask(taskId, changes) {
    await this.store.mutate((state) => {
      const task = state.tasks[taskId];
      if (!task) throw new BranchChatError("TASK_NOT_FOUND", `BranchChat task '${taskId}' disappeared from state.`);
      Object.assign(task, changes, { updatedAt: now() });
    });
  }

  #publicTask(task, gitInfo) {
    return {
      id: task.id,
      title: task.title,
      branch: task.branch,
      threadId: task.threadId || null,
      status: task.status,
      worktreePath: task.worktreePath,
      git: gitInfo,
    };
  }
}
