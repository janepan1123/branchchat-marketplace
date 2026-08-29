#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
plugin_dir="$(cd "$script_dir/.." && pwd)"
server_bundle="$plugin_dir/dist/server.mjs"
node_binary=""

is_supported_node() {
  [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1
}

if command -v node >/dev/null 2>&1 && is_supported_node "$(command -v node)"; then
  node_binary="$(command -v node)"
elif [[ -n "${NVM_BIN:-}" ]] && is_supported_node "${NVM_BIN}/node"; then
  node_binary="${NVM_BIN}/node"
else
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if is_supported_node "$candidate"; then
      node_binary="$candidate"
      break
    fi
  done
fi

if [[ -z "$node_binary" ]]; then
  shopt -s nullglob
  nvm_candidates=("${HOME}/.nvm/versions/node"/*/bin/node)
  for candidate in "${nvm_candidates[@]}"; do
    if is_supported_node "$candidate"; then
      node_binary="$candidate"
    fi
  done
fi

if [[ -z "$node_binary" ]]; then
  echo "BranchChat requires Node.js 20 or newer." >&2
  exit 127
fi

if [[ ! -f "$server_bundle" ]]; then
  echo "BranchChat runtime bundle is missing: $server_bundle" >&2
  echo "Run 'npm run build' from the plugin directory." >&2
  exit 1
fi

exec "$node_binary" "$server_bundle"
