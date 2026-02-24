# Web Search & Fetch — pi Extension

Two tools that let the agent browse the web like a human:

### `web_search`
Search the web, get back raw results (title, URL, snippet). Powered by OpenAI's
built-in `web_search` tool — uses your Codex subscription, no DDG rate limits.

### `web_fetch`
Fetch a URL and extract clean **Markdown** content. Three extraction methods:

| Method | When | How |
|--------|------|-----|
| **Readability + Turndown** | Default for HTML pages | Mozilla's Readability extracts article content, Turndown converts to Markdown |
| **Playwright + Readability** | JS-heavy SPAs, or when static extraction fails | Headless Chromium renders the page first, then Readability extracts |
| **Raw text** | Non-HTML content | Returns text as-is |

Also returns **links found on the page** so the agent can follow them.

## Workflow

```
Agent: web_search("pi coding agent release notes")
  → 10 results: title, URL, snippet

Agent: web_fetch(url="https://github.com/badlogic/pi-mono/releases")
  → Clean Markdown + 25 links found on page

Agent: web_fetch(url="https://mariozechner.at/posts/...")
  → Full blog post as Markdown

Agent: synthesizes answer from what it actually read
```

## Auth

Uses OpenAI's web search. Priority:
1. **Codex OAuth** — `/login` subscription (free with ChatGPT Plus/Pro)
2. **OpenAI API key** — `OPENAI_API_KEY` env var

## Dependencies

Installed in `node_modules/` (run `npm install` if missing):
- `@mozilla/readability` — article extraction (Firefox Reader View algorithm)
- `linkedom` — fast DOM parser (no browser needed)
- `turndown` — HTML to Markdown converter

Optional:
- **Playwright + Chromium** — for JS-rendered pages (`npx playwright install chromium`)

## Config

| Variable | Description |
|----------|-------------|
| `WEBSEARCH_MODEL` | Override model (default: `gpt-5.2` for Codex) |
| `OPENAI_API_KEY` | Fallback API key |
