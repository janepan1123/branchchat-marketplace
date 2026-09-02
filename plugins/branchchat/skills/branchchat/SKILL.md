---
name: branchchat
description: Create, inspect, synchronize, and switch isolated Codex coding tasks where each conversation is bound to one Git branch and one worktree. Use when the user asks which branch a coding chat belongs to, wants a new branch/worktree from the current conversation, or wants to list, switch, sync, or finish-check parallel BranchChat tasks. Do not use as a general Git client or for merging, pushing, deleting branches, or changing the current conversation's checkout.
---

# BranchChat

Treat a BranchChat task as one immutable mapping:

```text
conversation ↔ task ↔ branch ↔ worktree
```

“Switch branch” means opening the conversation already bound to that branch. Never run `git switch` or `git checkout` to move the current conversation onto another task's branch.

## Route the request

- Create or open an isolated coding task from this conversation: call `branchchat_create_task`.
- List parallel tasks: call `branchchat_list_tasks`.
- Open another task: call `branchchat_switch_task`.
- Answer which branch/worktree the current conversation belongs to: call `branchchat_status` with `task: "current"`.
- Repair title or persisted Git metadata drift: call `branchchat_sync`.
- Inspect readiness to finish without merging: call `branchchat_finish_inspect`.

Read [references/tool-contracts.md](references/tool-contracts.md) when selecting arguments, resolving ambiguous tasks, or explaining tool results. Read [references/safety-and-recovery.md](references/safety-and-recovery.md) when a tool reports drift, partial success, an unmanaged branch, state corruption, or recovery information.

## Required behavior

- Creating a task defaults to forking the current conversation. If the MCP context does not provide the current thread ID, stop with `CURRENT_THREAD_UNAVAILABLE`; do not guess from recent conversations.
- If the requested branch is already managed by an active BranchChat task, the create call validates, synchronizes, and opens that existing task in the same operation. Do not ask the user to send a second “open task” message.
- If the source Codex task belongs to a project, the created task must inherit that same `projectId`. Treat a returned `projectInherited: false` as a partial-success warning that should be surfaced.
- When the user does not name a base ref, omit `baseRef` and let the server detect the repository default. Never assume `main`.
- Let the BranchChat MCP tool create and validate branches/worktrees. Do not reproduce its Git mutations manually.
- If BranchChat task creation fails, surface its error and stop. Never fall back to a Codex-native worktree under `~/.codex/worktrees`.
- Before creation, tell the user that uncommitted source-worktree changes are not copied into a task based on another ref.
- Treat title and thread Git-metadata synchronization as best effort. A rename warning does not mean task creation failed.
- On `MAPPING_DRIFT`, stop mutation and present the expected and actual values. Do not auto-checkout a repair.
- Never push, merge, force, reset, clean, delete a branch, or forcibly remove a worktree.
- When the tool returns an ambiguous match, show the candidates and ask the user to choose; do not guess.

## Response shape

Lead with the observable outcome. For successful creation or switching, show whether the task was newly created or an existing task was reused, the task title, full branch, base ref/SHA when present, isolated worktree path, inherited Codex project when present, whether the target Codex task is visible in the task list, and whether it opened. Surface every warning. For status and finish inspection, distinguish clean/dirty state from commits ahead/behind and state explicitly that no merge or push was performed.
