# Changelog

## 0.1.0 no-restart reload workflow - 2026-09-01

- Document the Codex Desktop plugin off/on workflow that reloads BranchChat MCP without quitting the app.
- Clarify that the GitHub marketplace is public and consumers do not need repository access grants.

## 0.1.0 App Server resilience - 2026-09-01

- Retry transient Codex App Server startup exits before any Git resources are created.
- Preserve sanitized App Server exit diagnostics and return `APP_SERVER_EXITED` instead of a generic internal error.
- Serialize concurrent App Server initialization and never retry mutating task-fork requests.

## 0.1.0 automatic default base detection - 2026-09-01

- Detect the remote default branch when `baseRef` is omitted instead of assuming `main`.
- Fall back to the current source worktree branch when no remote default reference is available.
- Preserve strict `BASE_REF_NOT_FOUND` behavior for explicitly requested refs.
- Fork before the active MCP turn so Codex copies only completed history into the child task.
- Preserve App Server error details when a thread fork fails and is safely rolled back.
- Negotiate the `experimentalApi` App Server capability required by `thread/fork.runtimeWorkspaceRoots`.

## 0.1.0 repository-associated worktrees - 2026-09-01

- Create new worktrees in a repository-named sibling directory instead of a Codex or BranchChat home directory.
- Preserve `BRANCHCHAT_WORKTREES_ROOT` as an explicit override and keep legacy task mappings valid.
- Prohibit silent fallback to Codex-native worktrees after a BranchChat creation failure.

## 0.1.0 distribution update - 2026-08-29

- Bundle the MCP server and all JavaScript dependencies into `dist/server.mjs`.
- Run the installed plugin from the bundle so consumers do not need `npm install`.
- Add private repo-marketplace distribution instructions.

## 0.1.0 - 2026-08-28

- Add a local Codex skill and MCP server with six BranchChat tools.
- Bind each managed Codex task to one Git branch and one isolated worktree.
- Add atomic state, repository locks, drift detection, safe rollback, and read-only finish inspection.
