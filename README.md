# BranchChat Marketplace

Public Codex marketplace for BranchChat. BranchChat binds each managed Codex task to one Git branch and one isolated worktree.

By default, new worktrees live beside the local repository. For `/projects/apifarm`, BranchChat uses `/projects/apifarm-worktrees/<task-id>` rather than `~/.codex/worktrees`. These are local Git worktrees associated with the same repository; no remote push is performed.

When `baseRef` is omitted, BranchChat detects the remote default branch (such as `main` or `master`) and falls back to the current source branch if no remote default reference is available.

## Requirements

- macOS
- Git
- Codex Desktop or CLI with App Server support
- Node.js 20 or newer
- GitHub access to `janepan1123/branchchat-marketplace`

The JavaScript dependencies are already bundled into `plugins/branchchat/dist/server.mjs`. Consumers do not run `npm install`.

## Install

Run:

```bash
codex plugin marketplace add janepan1123/branchchat-marketplace --ref main
codex plugin add branchchat@branchchat-marketplace
```

You do not need to quit Codex. In Codex Desktop, open **Settings → Plugins**, switch **BranchChat** off, then switch it on again. This reloads the plugin's MCP server in the running app. Example:

```text
@BranchChat create an isolated task named Backend API from main.
```

## Update

```bash
codex plugin marketplace upgrade branchchat-marketplace
codex plugin add branchchat@branchchat-marketplace
```

Keep Codex open, then reload BranchChat from **Settings → Plugins** by switching it off and on. Existing tasks remain open and can use the refreshed MCP tools.

If an update changes only the Skill instructions and they are not reflected immediately, send the next message or open a new task; a full Codex restart is not required.

## Remove

```bash
codex plugin remove branchchat@branchchat-marketplace
codex plugin marketplace remove branchchat-marketplace
```

Removal does not delete Git branches, worktrees, or `~/.branchchat/state.json`.

## Development

```bash
cd plugins/branchchat
npm ci
npm run build
npm test
npm run validate
```

Commit the regenerated `dist/server.mjs` whenever MCP source or dependencies change.
