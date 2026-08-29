#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
CODEX_SYSTEM_SKILLS="${BRANCHCHAT_CODEX_SYSTEM_SKILLS:-${CODEX_HOME:-${HOME}/.codex}/skills/.system}"
SKILL_VALIDATOR="$CODEX_SYSTEM_SKILLS/skill-creator/scripts/quick_validate.py"
PLUGIN_VALIDATOR="$CODEX_SYSTEM_SKILLS/plugin-creator/scripts/validate_plugin.py"
cd "$PLUGIN_ROOT"
npm run validate
npm test
if [[ ! -f "$SKILL_VALIDATOR" || ! -f "$PLUGIN_VALIDATOR" ]]; then
  echo "Codex plugin validators were not found under $CODEX_SYSTEM_SKILLS" >&2
  echo "Set BRANCHCHAT_CODEX_SYSTEM_SKILLS to the Codex .system skills directory." >&2
  exit 1
fi
if command -v uv >/dev/null 2>&1; then
  uv run --with pyyaml python "$SKILL_VALIDATOR" "$PLUGIN_ROOT/skills/branchchat"
  uv run --with pyyaml python "$PLUGIN_VALIDATOR" "$PLUGIN_ROOT"
else
  "$PYTHON_BIN" "$SKILL_VALIDATOR" "$PLUGIN_ROOT/skills/branchchat"
  "$PYTHON_BIN" "$PLUGIN_VALIDATOR" "$PLUGIN_ROOT"
fi
