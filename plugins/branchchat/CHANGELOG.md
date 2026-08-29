# Changelog

## 0.1.0 distribution update - 2026-08-29

- Bundle the MCP server and all JavaScript dependencies into `dist/server.mjs`.
- Run the installed plugin from the bundle so consumers do not need `npm install`.
- Add private repo-marketplace distribution instructions.

## 0.1.0 - 2026-08-28

- Add a local Codex skill and MCP server with six BranchChat tools.
- Bind each managed Codex task to one Git branch and one isolated worktree.
- Add atomic state, repository locks, drift detection, safe rollback, and read-only finish inspection.
