#!/usr/bin/env bash
set -euo pipefail

INDEX="${VECTORIZE_INDEX:-yumeoi-memories}"

wrangler vectorize create "$INDEX" --dimensions=1024 --metric=cosine || true
wrangler vectorize create-metadata-index "$INDEX" --property-name=sourceId --type=string || true
wrangler vectorize create-metadata-index "$INDEX" --property-name=kind --type=string || true
wrangler vectorize create-metadata-index "$INDEX" --property-name=ts --type=number || true
wrangler vectorize list-metadata-index "$INDEX"
