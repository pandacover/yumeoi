# Connect a client

Horizon is one memory store with two ways in: **MCP over OAuth**, or a **Bearer API key** for HTTP and scripts. Cursor, Claude Desktop, Windsurf, Codex, Continue, and custom MCP hosts share the same MCP server and grant model. Brand-specific steps only exist where the host actually differs (install deeplink, redirect URI, stdio wrapper).

Tool-use guidance after you are connected lives in [`docs/agents.md`](agents.md) and is also the MCP `instructions` string.

## MCP (OAuth)

- **URL:** `https://<your-horizon>/mcp`
- **Scopes:** `memories:read memories:write`
- **Auth:** browser OAuth on first connect. Do **not** put an API key in MCP config.

Copy-paste configs and per-client grants are on **Agents** (`/agents`). Connected state is detected per client when the OAuth grant can be classified.

### Any MCP client (Windsurf, Codex, Continue, custom)

Most hosts that speak remote HTTP MCP take this `mcp.json` (or equivalent) block:

```json
{
  "mcpServers": {
    "horizon": {
      "url": "https://<your-horizon>/mcp"
    }
  }
}
```

Paste the URL, complete consent in the browser, then return to the host. Unknown grants show under **Any MCP client** on Agents.

If the host only speaks stdio MCP, wrap the same URL:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-horizon>/mcp"]
    }
  }
}
```

### Cursor

Same remote URL config as above. On Agents, **Add to Cursor** uses Cursor's MCP install deeplink (`cursor://anysphere.cursor-deeplink/mcp/install`). Cursor opens a browser, then returns to `http://localhost:8787/callback` on your machine — that loopback is Cursor, not the Worker.

### Claude Desktop

Same Horizon MCP URL and OAuth. Add a custom connector (Customize → Connectors → Add custom connector), or use the `mcp-remote` stdio config. Click **Allow access** once and wait; the browser must return to Claude.

## API keys (HTTP / scripts)

Mint a `ym_` key on Agents → **HTTP / scripts**. Send it as `Authorization: Bearer ym_…` to `/mcp`, `/api/*`, or `/ingest`. This is a different auth path, not a substitute for MCP OAuth.

```json
{
  "mcpServers": {
    "horizon": {
      "url": "https://<your-horizon>/mcp",
      "headers": {
        "Authorization": "Bearer ym_…"
      }
    }
  }
}
```
