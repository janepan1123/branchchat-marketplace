# Safety and recovery

BranchChat state at `~/.branchchat/state.json` is the source of truth for thread, branch, and worktree mappings. Thread titles are presentation only.

- `CURRENT_THREAD_UNAVAILABLE`: ask the user to invoke BranchChat from the source Codex conversation in a new thread. Do not choose the most recent thread.
- `BRANCH_EXISTS_UNMANAGED`: the Git branch exists without a BranchChat mapping. V0.1 cannot adopt it; choose another name or manage it manually.
- `TASK_DRIFT`: report expected versus actual branch/worktree and stop writes. Never repair with `git switch` automatically.
- `STATE_CORRUPT`: preserve the state file and report its path. Do not overwrite it with an empty state.
- `THREAD_FORK_FAILED`: report whether the newly created worktree/branch were rolled back, plus the returned App Server error details. If cleanup was incomplete, preserve every recovery path and command detail returned by the tool.
- `TITLE_SYNC_FAILED`: the coding task remains usable. Suggest `branchchat_sync` after the target conversation has completed its first turn.
- `DEEPLINK_OPEN_FAILED`: the task still exists. Give the thread ID so the user can select it from Codex history.

BranchChat V0.1 never automatically merges, pushes, resets, cleans, deletes branches, or force-removes worktrees.
After any BranchChat creation failure, stop and report the error. Do not substitute a Codex-native worktree under `~/.codex/worktrees`.
