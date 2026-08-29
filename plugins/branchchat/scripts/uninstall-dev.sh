#!/bin/bash
set -euo pipefail

MARKETPLACE_NAME="${1:-plugins-cli}"
codex plugin remove "branchchat@$MARKETPLACE_NAME"
