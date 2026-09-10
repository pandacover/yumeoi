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

# Generate apps/app/.dev.vars from the checked-in example so the dev server and
# Bearer-token APIs work out of the box. Any key whose value is supplied as a
# Cloud Agent secret (an env var of the same name) overrides the example
# default; missing secrets keep the example's placeholder. .dev.vars is
# gitignored and regenerated here, so real secret values are never committed.
DEV_VARS_EXAMPLE="apps/app/.dev.vars.example"
DEV_VARS="apps/app/.dev.vars"
if [ -f "${DEV_VARS_EXAMPLE}" ]; then
	tmp="$(mktemp)"
	while IFS= read -r line || [ -n "${line}" ]; do
		case "${line}" in
			[A-Za-z_]*=*)
				key="${line%%=*}"
				default="${line#*=}"
				env_val="${!key:-}"
				if [ -n "${env_val}" ]; then
					printf '%s=%s\n' "${key}" "${env_val}" >>"${tmp}"
				else
					printf '%s=%s\n' "${key}" "${default}" >>"${tmp}"
				fi
				;;
			*)
				printf '%s\n' "${line}" >>"${tmp}"
				;;
		esac
	done <"${DEV_VARS_EXAMPLE}"
	mv "${tmp}" "${DEV_VARS}"

	# When a Notion client is configured but no redirect URI was supplied,
	# default it to the local dev callback so the Sources OAuth flow can start.
	if grep -q '^NOTION_CLIENT_ID=..*' "${DEV_VARS}" && ! grep -q '^NOTION_REDIRECT_URI=..*' "${DEV_VARS}"; then
		sed -i 's#^NOTION_REDIRECT_URI=.*#NOTION_REDIRECT_URI=http://localhost:3000/api/sources/notion/callback#' "${DEV_VARS}"
	fi
fi

bun install --frozen-lockfile
