# @aemonculaba/pi-search

Web search + fetch extension for pi with an agent-first browse workflow:

1. `web_search(query)` → list of results (title, URL, snippet)
2. `web_fetch(url)` → clean Markdown content + links found on page

This avoids DDG scraping/rate limits by using OpenAI/Codex native web search.

## Tools

### `web_search`
Uses OpenAI `web_search` tool (Codex OAuth or OpenAI API key) and returns raw results.

### `web_fetch`
Fetches and extracts page content via:
- **Readability + Turndown** (default)
- **Playwright + Readability** fallback for JS-heavy pages
- **Raw text** fallback for non-HTML responses

Also returns links found on the page for follow-up crawling.

## Auth priority

1. `openai-codex` (`/login` subscription)
2. `openai` API key
3. `OPENAI_API_KEY` env var

## Local dev (no symlink)

```bash
npm install
npx playwright install chromium
pi install /absolute/path/to/pi-search
```

Then in pi run `/reload`.

To update while developing, just edit files and run `/reload` again.

## Install from npm in pi

```bash
pi install npm:@aemonculaba/pi-search
# or pin a version
pi install npm:@aemonculaba/pi-search@0.2.0
```

## Release / test install flow

1. Validate package locally:

```bash
npm ci
npm test
npm run pack:check
npm run release:dry-run
```

2. Publish a **dev tag** (for npm-based testing before latest):

```bash
npm version prerelease --preid=dev
npm publish --tag dev
```

Then test in pi:

```bash
pi remove npm:@aemonculaba/pi-search || true
pi install npm:@aemonculaba/pi-search@dev
```

3. Publish stable (tag + push):

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Action will publish to npm via Trusted Publishing (OIDC), no `NPM_TOKEN` needed.

4. Test official install in pi:

```bash
pi remove npm:@aemonculaba/pi-search || true
pi install npm:@aemonculaba/pi-search@0.2.0
```

## CI/CD

- `CI` workflow: install, test, package dry-check on push/PR
- `Release` workflow: publish to npm on `v*` tags (or manual dispatch) using npm Trusted Publishing

## Policy (baked into extension)

This package includes a web-tool policy that enforces `web_search` + `web_fetch` for web access.

When enabled (default):
- injects guidance into the system prompt each turn
- blocks known alternate web-search/web-fetch tools
- optionally blocks bash-based web fetching (`curl`, `wget`, raw URLs, etc.)

## Config

| Variable | Description |
|---|---|
| `WEBSEARCH_PROVIDER` | Force provider (`openai`) |
| `WEBSEARCH_MODEL` | Override model (default `gpt-5.2` for codex) |
| `OPENAI_API_KEY` | API key fallback |
| `PI_SEARCH_ENFORCE_WEB_POLICY` | Enable/disable embedded policy (`true` by default) |
| `PI_SEARCH_BLOCK_BASH_WEB` | Block bash web-fetch patterns (`true` by default) |
| `PI_SEARCH_EXTRA_BLOCKED_TOOLS` | CSV list of extra tool names to block |
| `PI_SEARCH_ALLOWED_WEB_TOOLS` | CSV list of blocked tools to allow |

## Managing pi extensions and migrating across servers

See [`docs/PI_AGENT_OPERATIONS.md`](docs/PI_AGENT_OPERATIONS.md) for a practical playbook:
- package-based extension management
- version pinning for reproducibility
- project-local `.pi/settings.json` strategy
- migration checklist for new servers
