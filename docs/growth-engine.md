# Growth Engine (Signals + Social)

This module handles market research and social broadcasting. It splits responsibilities between the Cloud (memory) and the Local Machine (execution).

## Architecture

### Cloud (Backend API + DynamoDB)
- **Signals:** Potential leads/threads stored as `SIGNAL#<id>` in DynamoDB via `POST /signals`.
- **Research endpoint:** `POST /research/search` — fetches tenant's Brave API key from settings, calls Brave Search API, returns formatted results.
- **Configuration:** API keys (Brave Search) stored in `TenantConfig.integrations` via the Admin Settings page.
- **No SaaS wrappers.** We use raw infrastructure (Brave API, Playwright) — not third-party scheduling services.

### Local (MCP Server + Playwright)
The MCP Server (`tools/mcp-server`) acts as the execution layer:
- **Browser automation:** Playwright with `chromium`, running locally on the user's machine.
- **Session state:** Social cookies saved to `tools/mcp-server/.storage/<platform>.json` (gitignored).
- **Research:** MCP fetches Brave API Key from Backend (`GET /settings`), then calls Brave directly.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `search_web` | Brave web search (key from tenant settings) |
| `scrape_url` | Extract text from a URL via cheerio |
| `save_signal` | Save analyzed lead to backend |
| `list_signals` | List all signals for a tenant |
| `social_login` | Open browser for manual login, save cookies |
| `post_social` | Post to social platform using saved session |

## Workflow

1. **Auth:** User runs `social_login("linkedin")` → MCP opens Chrome → User logs in → Cookies saved to disk.
2. **Research:** Claude calls `search_web` → MCP calls Brave → Claude analyzes results → Calls `save_signal` to persist.
3. **Action:** Claude calls `post_social` → MCP loads cookies → Automates the post via Playwright.

## Supported Platforms

`linkedin`, `X`, `reddit`, `facebook` — each with platform-specific selectors in `post_social`.
