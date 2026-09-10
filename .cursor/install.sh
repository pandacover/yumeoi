#!/usr/bin/env bash
# Cloud Agent install step: provision the pinned Bun toolchain and project deps.
# Idempotent: safe to run repeatedly and against cached/partial state.
set -euo pipefail

# Keep in sync with the "packageManager" field in package.json and the CI
# oven-sh/setup-bun version in .github/workflows/ci.yml.
BUN_VERSION="1.4.2"

# The default Cloud Agent image ships Node but not Bun, so install the pinned
# Bun toolchain when it is missing or the wrong version. The installer is a
# no-op when the correct version is already present.
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "${BUN_VERSION}" ]; then
	curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi

export BUN_INSTALL="${HOME}/.bun"
export PATH="${BUN_INSTALL}/bin:${PATH}"

# Make Bun resolvable from non-interactive start/terminal shells as well.
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
	sudo ln -sf "${BUN_INSTALL}/bin/bun" /usr/local/bin/bun
	sudo ln -sf "${BUN_INSTALL}/bin/bun" /usr/local/bin/bunx
fi

# Seed local Worker dev secrets from the checked-in example when absent so the
# dev server and Bearer-token APIs work out of the box.
if [ ! -f apps/app/.dev.vars ]; then
	cp apps/app/.dev.vars.example apps/app/.dev.vars
fi

bun install --frozen-lockfile
