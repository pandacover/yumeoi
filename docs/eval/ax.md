# AX eval

Scripted agent scenarios: `docs/eval/ax-scenarios.json` (15 cases). Runner: `bun run eval:ax`.

Gate: success ≥ 0.9, tokens per recall −40% vs M4 JSON (`JSON.stringify(..., null, 2)`).

| Metric | Value | Gate |
|---|---|---|
| Success | 0.933 | ≥ 0.9 |
| Markdown / JSON token ratio | 0.186 | ≤ 0.60 |
| docs/agents.md matches server instructions | yes | yes |

| Scenario | Pass | MD tokens | JSON tokens |
|---|---|---|---|
| remember-then-answer | yes | 109 | 738 |
| correct-fact | yes | 38 | 252 |
| august-decision | no | 1 | 9 |
| forget-agent-write | yes | 1 | 9 |
| feedback-plus | yes | 36 | 250 |
| feedback-minus | yes | 34 | 249 |
| extract-mode | yes | 0 | 0 |
| client-ref | yes | 0 | 0 |
| conflict-pair | yes | 30 | 241 |
| markdown-default | yes | 40 | 256 |
| search-list | yes | 0 | 0 |
| get-memory-history | yes | 0 | 0 |
| howto-intent | yes | 45 | 259 |
| json-format | yes | 149 | 246 |
| list-sources | yes | 0 | 0 |
