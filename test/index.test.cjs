const test = require('node:test');
const assert = require('node:assert/strict');
const jiti = require('jiti')(__filename, { interopDefault: true });

const mod = jiti('../index.ts');
const t = mod.__testables;

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

test('isCodexJwt detects codex OAuth tokens', () => {
  const token = makeJwt({
    'https://api.openai.com/auth': { chatgpt_account_id: 'abc-123' },
  });
  assert.equal(t.isCodexJwt(token), true);
  assert.equal(t.isCodexJwt('sk-plain-api-key'), false);
});

test('extractAccountId returns chatgpt account id from codex jwt', () => {
  const token = makeJwt({
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct-xyz' },
  });
  assert.equal(t.extractAccountId(token), 'acct-xyz');
  assert.equal(t.extractAccountId('not.a.jwt'), undefined);
});

test('extractSnippetAround strips markdown links and truncates', () => {
  const text = '1234567890 [Example](https://example.com) and some extra context around the cited content.';
  const snippet = t.extractSnippetAround(text, 0, text.length);
  assert.ok(snippet.includes('Example'));
  assert.equal(snippet.includes('https://example.com'), false);
});

test('extractSearchResults deduplicates URL citations and backfills sources', () => {
  const response = {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Some text with citations',
            annotations: [
              {
                type: 'url_citation',
                title: 'Source A',
                url: 'https://a.test?utm_source=openai',
                start_index: 0,
                end_index: 10,
              },
              {
                type: 'url_citation',
                title: 'Source A duplicate',
                url: 'https://a.test?utm_source=openai',
                start_index: 0,
                end_index: 10,
              },
            ],
          },
        ],
      },
      {
        type: 'web_search_call',
        action: {
          sources: [
            { url: 'https://a.test?utm_source=openai' },
            { url: 'https://b.test' },
          ],
        },
      },
    ],
  };

  const results = t.extractSearchResults(response);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://a.test');
  assert.equal(results[1].url, 'https://b.test');
});

test('htmlToMarkdown extracts readable markdown and absolute links', () => {
  const html = `
    <html><head><title>Ignore me</title></head>
    <body>
      <article>
        <h1>My Article</h1>
        <p>Hello <a href="/docs/page">world</a>.</p>
      </article>
    </body></html>
  `;

  const out = t.htmlToMarkdown(html, 'https://example.com/base');
  assert.ok(out);
  assert.ok(out.markdown.includes('My Article'));
  assert.ok(out.markdown.includes('[world](/docs/page)'));
  assert.ok(out.links.includes('https://example.com/docs/page'));
});

test('parseSSEResponse returns response from response.done event', async () => {
  const sse = [
    'data: {"type":"response.in_progress"}',
    'data: {"type":"response.done","response":{"output":[{"type":"message"}]}}',
    'data: [DONE]',
    '',
  ].join('\n');

  const resp = new Response(sse, { status: 200 });
  const parsed = await t.parseSSEResponse(resp);
  assert.deepEqual(parsed, { output: [{ type: 'message' }] });
});
