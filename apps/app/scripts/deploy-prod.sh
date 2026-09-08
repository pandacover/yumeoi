#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
	echo "CLOUDFLARE_API_TOKEN is not set. Add it as a Cursor Runtime Secret and rerun." >&2
	exit 1
fi

bash ./scripts/provision-vectorize.sh
if ! bunx wrangler d1 migrations apply yumeoi --remote; then
	echo "wrangler could not apply D1 migrations (token needs Account > D1 > Edit). Continuing because tables were provisioned via the Cloudflare API." >&2
fi

bun run build

secrets_file="$(mktemp)"
trap 'rm -f "$secrets_file"' EXIT

SECRETS_FILE="$secrets_file" node --input-type=module -e '
import { writeFileSync } from "node:fs";
const keys = [
	"OPENROUTER_API_KEY",
	"OPENAI_API_KEY",
	"YUMEOI_API_KEY",
	"YUMEOI_USER_ID",
	"TOKEN_ENCRYPTION_KEY",
	"NOTION_CLIENT_ID",
	"NOTION_CLIENT_SECRET",
	"NOTION_REDIRECT_URI",
];
const secrets = Object.fromEntries(keys.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
writeFileSync(process.env.SECRETS_FILE, JSON.stringify(secrets));
console.error("Worker secrets to upload:", Object.keys(secrets).sort().join(", ") || "(none)");
'

if [[ "$(wc -c < "$secrets_file")" -gt 2 ]]; then
	bunx wrangler deploy --secrets-file "$secrets_file"
else
	bunx wrangler deploy
fi
