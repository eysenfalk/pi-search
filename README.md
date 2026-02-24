# @eysenfalk/pi-search

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

## Local dev

```bash
npm install
npx playwright install chromium
./scripts/link-to-pi.sh
```

Then in pi run `/reload`.

## Install from npm in pi

```bash
pi install npm:@eysenfalk/pi-search
# or pin a version
pi install npm:@eysenfalk/pi-search@0.1.0
```

## Release / test install flow

1. Validate package locally:

```bash
npm ci
npm test
npm run pack:check
npm run release:dry-run
```

2. Publish (tag + push):

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Action will publish to npm using `NPM_TOKEN` secret.

3. Test official install in pi:

```bash
pi remove npm:@eysenfalk/pi-search || true
pi install npm:@eysenfalk/pi-search@0.1.0
```

## CI/CD

- `CI` workflow: install, test, package dry-check on push/PR
- `Release` workflow: publish to npm on `v*` tags (or manual dispatch)
- `CodeRabbit` workflow: AI PR review on pull requests

## Config

| Variable | Description |
|---|---|
| `WEBSEARCH_PROVIDER` | Force provider (`openai`) |
| `WEBSEARCH_MODEL` | Override model (default `gpt-5.2` for codex) |
| `OPENAI_API_KEY` | API key fallback |
