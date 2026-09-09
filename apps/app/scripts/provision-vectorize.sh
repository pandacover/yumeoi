#!/usr/bin/env bash
set -euo pipefail

INDEX="${VECTORIZE_INDEX:-yumeoi-memories}"

create_ok=0
wrangler vectorize create "$INDEX" --dimensions=1024 --metric=cosine && create_ok=1 || true

if ! wrangler vectorize get "$INDEX" >/dev/null 2>&1; then
	echo "Vectorize index '${INDEX}' is missing and could not be created." >&2
	echo "CLOUDFLARE_API_TOKEN needs Account > Vectorize > Edit (Workers Paid). Update the token, then rerun bun run deploy." >&2
	exit 1
fi

ensure_metadata_index() {
	local property="$1"
	local type="$2"
	wrangler vectorize create-metadata-index "$INDEX" --property-name="$property" --type="$type" || true
}

if [[ "$create_ok" -eq 1 ]]; then
	ensure_metadata_index sourceId string
	ensure_metadata_index kind string
	ensure_metadata_index ts number
fi

ensure_metadata_index type string
ensure_metadata_index state string
ensure_metadata_index eventAt number
ensure_metadata_index validTo number

wrangler vectorize list-metadata-index "$INDEX"
