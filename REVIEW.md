# Review: pi-search

## What’s good

- Clear two-tool architecture (`web_search` + `web_fetch`) that enables iterative browsing.
- OpenAI/Codex auth handling works for both OAuth JWT and API key paths.
- `web_fetch` extraction quality is solid (Readability + Turndown) with JS fallback via Playwright.
- Output truncation protects model context from huge pages.
- Link extraction allows follow-up crawling by the agent.

## Risks / caveats

1. **Markdown links may stay relative**
   - `htmlToMarkdown()` keeps relative hrefs in markdown text (`/path`) while `links[]` are absolute.
   - Not broken, but can be confusing in output.

2. **Playwright dependency cost**
   - First-time install is heavy (Chromium download).
   - Runtime startup is slower for JS-heavy fetches.

3. **SSE parser assumes `response.done`/`response.completed`**
   - Works with current OpenAI format, but schema changes could break parsing.

4. **No retry/backoff yet**
   - Transient network/API rate limit errors return immediately.

## Suggested next improvements

- Normalize markdown links to absolute URLs.
- Add retries with exponential backoff for `web_search` and `web_fetch` network calls.
- Add optional domain include/exclude filtering on `web_search` results.
- Add integration tests with mocked fetch for end-to-end tool behavior.
