# BranchChat tool contracts

Use the six `branchchat_*` MCP tools; do not substitute shell Git mutations.

## Create

`branchchat_create_task` requires `taskTitle`. Optional fields are `branchName`, `baseRef`, and `openAfterCreate` (default `true`). When `baseRef` is omitted, the server uses the remote default branch (`origin/HEAD` first, then other remotes) and falls back to the current source worktree branch. An explicitly provided `baseRef` is never replaced if it does not exist. When `branchName` is omitted the server creates a `branchchat/<slug>` name. The current Codex thread comes only from MCP `_meta.threadId`.

Creation is idempotent by repository and full branch name. If that branch already has an active BranchChat mapping, the same call validates its worktree, synchronizes its title and metadata, verifies task-list visibility, and opens its existing Codex task. The result returns `created: false` and `reused: true`; do not call `branchchat_switch_task` as a second step. A managed task that is incomplete or in an error state returns `TASK_NOT_READY` instead of creating conflicting Git resources.

BranchChat marks the fork as a user-owned task so Codex includes it in the normal task list, verifies that visibility, and then opens it when `openAfterCreate` is enabled. Report the new child thread ID, branch, frozen base SHA, worktree, title, task-list visibility, open result, and warnings. A source worktree may be dirty; those uncommitted edits are not copied into the new worktree.

When `thread/read` reports a non-empty source `projectId`, BranchChat persists it with the task and assigns the child thread to that same Codex project through `thread/metadata/update`. Report `projectInherited`; a false value means the Git task exists but project metadata synchronization needs attention. A source task without a project leaves the child unassigned.

Creation runs during an active Codex turn. The server forks before that in-progress turn so the child receives completed conversation history without copying an unfinished assistant response.

By default, a repository at `/projects/apifarm` gets new worktrees under the local sibling directory `/projects/apifarm-worktrees/`. This is a local Git worktree linked to the same repository; creation never pushes to or writes directly into the remote. `BRANCHCHAT_WORKTREES_ROOT` remains an explicit override.

## List

`branchchat_list_tasks` accepts `includeArchived`. With current-thread context it prefers that repository; without context it may return tasks across repositories. Group results by repository when more than one is returned.

## Switch

`branchchat_switch_task` accepts `task`, matched against task ID, exact title, full branch, or short branch. It validates the stored worktree/branch and opens the bound Codex thread. It never performs `git switch`. On `AMBIGUOUS_TASK`, show candidate IDs, titles, and branches.

## Status and sync

`branchchat_status` accepts a task selector, defaulting to `current`. It is read-only. `branchchat_sync` may update only the Codex thread title, persisted `gitInfo`, and BranchChat metadata; it must not rename or check out a Git branch.

## Finish inspection

`branchchat_finish_inspect` is read-only. It returns dirty files, commits ahead, files changed from the frozen base, and a copyable merge command. Do not run that command unless the user separately and explicitly requests a merge.
