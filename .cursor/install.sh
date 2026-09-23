#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the JSpace CLI (bun + TypeScript).
# Pins bun to the version CI uses (see .github/workflows/verify.yml).
set -euo pipefail

BUN_VERSION="1.3.14"
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

install_bun() {
  echo "Installing bun v${BUN_VERSION}..."
  curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh
  SHELL="${SHELL:-/bin/bash}" bash /tmp/bun-install.sh "bun-v${BUN_VERSION}"
}

if ! command -v bun >/dev/null 2>&1; then
  install_bun
elif [ "$(bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  install_bun
fi

# Make bun/bunx resolvable from any (non-login) shell the agent spawns.
if command -v sudo >/dev/null 2>&1; then
  sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun
  sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bunx
fi

echo "bun $(bun --version) ready"

cd "$(dirname "$0")/.."
bun install --frozen-lockfile
