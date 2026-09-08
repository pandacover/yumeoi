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

if [[ "$create_ok" -eq 1 ]]; then
	wrangler vectorize create-metadata-index "$INDEX" --property-name=sourceId --type=string || true
	wrangler vectorize create-metadata-index "$INDEX" --property-name=kind --type=string || true
	wrangler vectorize create-metadata-index "$INDEX" --property-name=ts --type=number || true
fi

wrangler vectorize list-metadata-index "$INDEX"
