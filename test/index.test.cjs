const test = require('node:test');
const assert = require('node:assert/strict');
const jiti = require('jiti')(__filename, { interopDefault: true });

const mod = jiti('../index.ts');
assert.ok(mod, 'module export missing from index.ts');
assert.ok(mod.__testables, '__testables export missing from index.ts');
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

test('env helpers parse booleans and CSV values', () => {
  process.env.PI_SEARCH_TMP_BOOL = 'false';
  process.env.PI_SEARCH_TMP_CSV = 'a, b ,, c';

  assert.equal(t.isEnvEnabled('PI_SEARCH_TMP_BOOL', true), false);
  assert.deepEqual(t.parseCsvEnv('PI_SEARCH_TMP_CSV'), ['a', 'b', 'c']);

  delete process.env.PI_SEARCH_TMP_BOOL;
  delete process.env.PI_SEARCH_TMP_CSV;
});

test('getBlockedWebTools keeps web_search/web_fetch unblocked', () => {
  process.env.PI_SEARCH_EXTRA_BLOCKED_TOOLS = 'web_search,web_fetch,custom_tool';
  process.env.PI_SEARCH_ALLOWED_WEB_TOOLS = 'mcp_fetch';

  const blocked = t.getBlockedWebTools();
  assert.equal(blocked.has('web_search'), false);
  assert.equal(blocked.has('web_fetch'), false);
  assert.equal(blocked.has('custom_tool'), true);
  assert.equal(blocked.has('mcp_fetch'), false);

  delete process.env.PI_SEARCH_EXTRA_BLOCKED_TOOLS;
  delete process.env.PI_SEARCH_ALLOWED_WEB_TOOLS;
});

function makePiStub() {
  const handlers = new Map();
  const tools = [];
  return {
    pi: {
      on(event, handler) {
        handlers.set(event, handler);
      },
      registerTool(tool) {
        tools.push(tool);
      },
    },
    handlers,
    tools,
  };
}

test('webBrowseExtension registers policy hooks and blocks blocked web tools', async () => {
  delete process.env.PI_SEARCH_ENFORCE_WEB_POLICY;
  delete process.env.PI_SEARCH_BLOCK_BASH_WEB;
  delete process.env.PI_SEARCH_EXTRA_BLOCKED_TOOLS;
  delete process.env.PI_SEARCH_ALLOWED_WEB_TOOLS;

  const { pi, handlers, tools } = makePiStub();
  mod.default(pi);

  assert.equal(typeof handlers.get('before_agent_start'), 'function');
  assert.equal(typeof handlers.get('tool_call'), 'function');
  assert.equal(tools.length >= 2, true);

  const onBefore = handlers.get('before_agent_start');
  const beforeResult = await onBefore({ systemPrompt: 'base prompt' });
  assert.ok(beforeResult.systemPrompt.includes('Web policy: use only tools `web_search` and `web_fetch`'));

  const onToolCall = handlers.get('tool_call');
  const blocked = await onToolCall({ toolName: 'mcp_fetch', input: {} });
  assert.deepEqual(blocked, {
    block: true,
    reason: 'Blocked by pi-search policy: use `web_search` / `web_fetch` only for web access.',
  });

  const allowedSearch = await onToolCall({ toolName: 'web_search', input: { query: 'x' } });
  const allowedFetch = await onToolCall({ toolName: 'web_fetch', input: { url: 'https://example.com' } });
  assert.equal(allowedSearch, undefined);
  assert.equal(allowedFetch, undefined);
});

test('webBrowseExtension blocks bash web-command patterns by default', async () => {
  delete process.env.PI_SEARCH_ENFORCE_WEB_POLICY;
  delete process.env.PI_SEARCH_BLOCK_BASH_WEB;

  const { pi, handlers } = makePiStub();
  mod.default(pi);

  const onToolCall = handlers.get('tool_call');
  assert.equal(typeof onToolCall, 'function');

  const matrix = [
    'curl https://example.com',
    'wget http://example.com/file.txt',
    'echo https://example.com',
    "node -e \"fetch('https://example.com')\"",
    "python -c \"import requests; requests.get('https://example.com')\"",
  ];

  for (const command of matrix) {
    const result = await onToolCall({ toolName: 'bash', input: { command } });
    assert.deepEqual(result, {
      block: true,
      reason: 'Blocked by pi-search policy: web access via bash is disabled. Use `web_search` / `web_fetch`.',
    });
  }
});

test('webBrowseExtension does not block bash when filename contains links token', async () => {
  delete process.env.PI_SEARCH_ENFORCE_WEB_POLICY;
  delete process.env.PI_SEARCH_BLOCK_BASH_WEB;

  const { pi, handlers } = makePiStub();
  mod.default(pi);

  const onToolCall = handlers.get('tool_call');
  assert.equal(typeof onToolCall, 'function');

  const allowedCommand = 'git add tests/docs/workflow-links.test.ts && git status --short';
  const allowedResult = await onToolCall({ toolName: 'bash', input: { command: allowedCommand } });
  assert.equal(allowedResult, undefined);

  const blockedResult = await onToolCall({ toolName: 'bash', input: { command: 'links https://example.com' } });
  assert.deepEqual(blockedResult, {
    block: true,
    reason: 'Blocked by pi-search policy: web access via bash is disabled. Use `web_search` / `web_fetch`.',
  });
});

test('PI_SEARCH_BLOCK_BASH_WEB=false disables bash web-command blocking', async () => {
  delete process.env.PI_SEARCH_ENFORCE_WEB_POLICY;
  process.env.PI_SEARCH_BLOCK_BASH_WEB = 'false';

  const { pi, handlers } = makePiStub();
  mod.default(pi);

  const onToolCall = handlers.get('tool_call');
  assert.equal(typeof onToolCall, 'function');

  const result = await onToolCall({ toolName: 'bash', input: { command: 'curl https://example.com' } });
  assert.equal(result, undefined);

  delete process.env.PI_SEARCH_BLOCK_BASH_WEB;
});

test('PI_SEARCH_ENFORCE_WEB_POLICY=false disables policy hook registration', () => {
  process.env.PI_SEARCH_ENFORCE_WEB_POLICY = 'false';
  delete process.env.PI_SEARCH_BLOCK_BASH_WEB;

  const { pi, handlers, tools } = makePiStub();
  mod.default(pi);

  assert.equal(handlers.has('before_agent_start'), false);
  assert.equal(handlers.has('tool_call'), false);
  assert.equal(tools.length >= 2, true);

  delete process.env.PI_SEARCH_ENFORCE_WEB_POLICY;
});
