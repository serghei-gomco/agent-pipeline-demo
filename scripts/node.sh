#!/usr/bin/env bash
# Run a command with the Node version from .nvmrc when the default `node` is too old (< 18).
# Lets agents and humans call the same commands on machines where nvm's default is an old Node.
set -euo pipefail
cd "$(dirname "$0")/.."
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 18 ] && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  set +u; . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null; nvm use --silent >/dev/null; set -u
fi
exec "$@"
