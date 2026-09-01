# BranchChat for Codex

BranchChat binds each Codex coding conversation to one Git branch and one isolated worktree. Switching a task opens its bound conversation; it never checks another branch out in the current conversation's workspace.

## Requirements

- macOS
- Git
- Codex Desktop or CLI with App Server support
- Node.js 20 or newer

## Commands in Codex

Ask BranchChat to create an isolated task, list tasks, switch tasks, show the current branch/worktree, synchronize metadata, or inspect a task before finishing. The plugin exposes six local MCP tools and stores mappings in `~/.branchchat/state.json`.

New worktrees are local and repository-associated. For a repository at `/projects/apifarm`, BranchChat creates them under the sibling directory `/projects/apifarm-worktrees/<task-id>`, not under `~/.codex/worktrees`. Git worktrees cannot live on a remote server; they share the local repository and do not push anything. Set `BRANCHCHAT_WORKTREES_ROOT` only when an explicit custom local root is required. Existing tasks created under the older `~/.branchchat/worktrees` layout remain supported.

Examples:

```text
Create an isolated BranchChat task named Backend API from main.
Create an isolated BranchChat task named Backend API.
Show my BranchChat tasks.
Which branch and worktree belong to this conversation?
Open the Backend API task.
Inspect the current task before finishing.
```

When no base ref is specified, BranchChat detects the remote default branch (for example `main` or `master`) and falls back to the current source branch when no remote default is available. An explicitly requested missing ref still fails with `BASE_REF_NOT_FOUND`.

BranchChat never automatically merges, pushes, resets, cleans, or deletes a branch.
If BranchChat cannot create a task, it reports the failure and does not fall back to a Codex-native worktree.

## Install from the private GitHub marketplace

```bash
codex plugin marketplace add janepan1123/branchchat-marketplace --ref main
codex plugin add branchchat@branchchat-marketplace
```

The repository is private, so Git must already be authenticated for the GitHub account that was granted access. Runtime dependencies are bundled into `dist/server.mjs`; consumers do not run `npm install`.

Open a new Codex task after installation so the Skill and MCP tools are loaded. In the app, select **Plugins / Sources → BranchChat**, or mention `@BranchChat` where plugin mentions are supported.

To remove the plugin configuration and cached copy:

```bash
codex plugin remove branchchat@branchchat-marketplace
```

## Development

```bash
npm ci
npm run build
npm test
npm run validate
npm run smoke
```

The committed `dist/server.mjs` is the install-time runtime. After changing source, rebuild it, update the Codex cachebuster, publish the marketplace, upgrade/reinstall it, and test from a new Codex task.
