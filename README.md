# pi-search

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

## Install

```bash
npm install
npx playwright install chromium
./scripts/link-to-pi.sh
```

Then in pi run `/reload`.

## Tests

```bash
npm test
```

Covers pure helpers for:
- JWT detection and account-id extraction
- SSE response parsing
- search result extraction & dedupe
- snippet extraction
- HTML → Markdown extraction

## Config

| Variable | Description |
|---|---|
| `WEBSEARCH_PROVIDER` | Force provider (`openai`) |
| `WEBSEARCH_MODEL` | Override model (default `gpt-5.2` for codex) |
| `OPENAI_API_KEY` | API key fallback |
