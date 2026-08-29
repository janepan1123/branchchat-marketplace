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

- Create an isolated coding task from this conversation: call `branchchat_create_task`.
- List parallel tasks: call `branchchat_list_tasks`.
- Open another task: call `branchchat_switch_task`.
- Answer which branch/worktree the current conversation belongs to: call `branchchat_status` with `task: "current"`.
- Repair title or persisted Git metadata drift: call `branchchat_sync`.
- Inspect readiness to finish without merging: call `branchchat_finish_inspect`.

Read [references/tool-contracts.md](references/tool-contracts.md) when selecting arguments, resolving ambiguous tasks, or explaining tool results. Read [references/safety-and-recovery.md](references/safety-and-recovery.md) when a tool reports drift, partial success, an unmanaged branch, state corruption, or recovery information.

## Required behavior

- Creating a task defaults to forking the current conversation. If the MCP context does not provide the current thread ID, stop with `CURRENT_THREAD_UNAVAILABLE`; do not guess from recent conversations.
- Let the BranchChat MCP tool create and validate branches/worktrees. Do not reproduce its Git mutations manually.
- Before creation, tell the user that uncommitted source-worktree changes are not copied into a task based on another ref.
- Treat title and thread Git-metadata synchronization as best effort. A rename warning does not mean task creation failed.
- On `MAPPING_DRIFT`, stop mutation and present the expected and actual values. Do not auto-checkout a repair.
- Never push, merge, force, reset, clean, delete a branch, or forcibly remove a worktree.
- When the tool returns an ambiguous match, show the candidates and ask the user to choose; do not guess.

## Response shape

Lead with the observable outcome. For successful creation or switching, show the task title, full branch, base ref/SHA when present, isolated worktree path, and whether the target Codex conversation opened. Surface every warning. For status and finish inspection, distinguish clean/dirty state from commits ahead/behind and state explicitly that no merge or push was performed.
