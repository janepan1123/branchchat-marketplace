#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE_NAME="${1:-plugins-cli}"
cd "$PLUGIN_ROOT"
npm ci
npm test
codex plugin add "branchchat@$MARKETPLACE_NAME"
