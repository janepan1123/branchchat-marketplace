# BranchChat for Codex

BranchChat binds each Codex coding conversation to one Git branch and one isolated worktree. Switching a task opens its bound conversation; it never checks another branch out in the current conversation's workspace.

## Requirements

- macOS
- Git
- Codex Desktop or CLI with App Server support
- Node.js 20 or newer

## Commands in Codex

Ask BranchChat to create an isolated task, list tasks, switch tasks, show the current branch/worktree, synchronize metadata, or inspect a task before finishing. The plugin exposes six local MCP tools and stores mappings in `~/.branchchat/state.json`.

Examples:

```text
Create an isolated BranchChat task named Backend API from main.
Show my BranchChat tasks.
Which branch and worktree belong to this conversation?
Open the Backend API task.
Inspect the current task before finishing.
```

BranchChat never automatically merges, pushes, resets, cleans, or deletes a branch.

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
