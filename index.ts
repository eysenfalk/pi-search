/**
 * Web Search & Fetch Extension for pi
 *
 * Two tools for agent-driven web browsing:
 *
 *   web_search  — Returns raw search results (title, URL, snippet) via
 *                 OpenAI Codex/API web_search. Agent decides which to open.
 *
 *   web_fetch   — Fetches a URL and returns clean Markdown text.
 *                 Uses Readability + Turndown for static pages,
 *                 Playwright (headless Chromium) for JS-rendered pages.
 *                 Handles HTML, JS-heavy SPAs, and more.
 *
 * Workflow: search → pick links → fetch pages → follow links → synthesize
 *
 * Auth: openai-codex (OAuth) → openai (API key) → OPENAI_API_KEY env
 * Override: WEBSEARCH_PROVIDER, WEBSEARCH_MODEL env vars
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
// These are available in pi's jiti runtime
let truncateHead: any;
let DEFAULT_MAX_BYTES = 50_000;
let DEFAULT_MAX_LINES = 2000;
let formatSize: (bytes: number) => string = (b) => `${(b / 1024).toFixed(1)}KB`;

try {
	const piAgent = require("@mariozechner/pi-coding-agent");
	truncateHead = piAgent.truncateHead;
	DEFAULT_MAX_BYTES = piAgent.DEFAULT_MAX_BYTES ?? 50_000;
	DEFAULT_MAX_LINES = piAgent.DEFAULT_MAX_LINES ?? 2000;
	formatSize = piAgent.formatSize ?? formatSize;
} catch {
	// Fallback: simple truncation
	truncateHead = (text: string, opts: { maxLines: number; maxBytes: number }) => {
		const lines = text.split("\n");
		const maxLines = opts.maxLines ?? 2000;
		const maxBytes = opts.maxBytes ?? 50_000;
		let output = "";
		let lineCount = 0;
		for (const line of lines) {
			if (lineCount >= maxLines || output.length + line.length > maxBytes) {
				return {
					content: output,
					truncated: true,
					outputLines: lineCount,
					totalLines: lines.length,
					outputBytes: output.length,
					totalBytes: text.length,
				};
			}
			output += (lineCount > 0 ? "\n" : "") + line;
			lineCount++;
		}
		return { content: output, truncated: false, outputLines: lineCount, totalLines: lines.length, outputBytes: output.length, totalBytes: text.length };
	};
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, string> = {
	"openai-codex": "gpt-5.2",
	openai: "gpt-4o",
};

const AUTH_PROBE_ORDER = ["openai-codex", "openai"];

const FETCH_TIMEOUT_MS = 30_000;
const SEARCH_TIMEOUT_MS = 60_000;

// Turndown instance (reused)
const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});

// Remove images and iframes from markdown output (noise for LLMs)
turndown.remove(["img", "iframe", "video", "audio", "canvas", "svg"]);

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

async function resolveAuth(ctx: any): Promise<{ provider: string; apiKey: string; model: string } | undefined> {
	const forced = process.env.WEBSEARCH_PROVIDER?.toLowerCase();
	if (forced === "openai") {
		const key = process.env.OPENAI_API_KEY;
		if (key) return { provider: "openai", apiKey: key, model: process.env.WEBSEARCH_MODEL ?? "gpt-4o" };
	}

	const { getModel } = await import("@mariozechner/pi-ai");
	for (const providerId of AUTH_PROBE_ORDER) {
		if (forced && providerId !== forced && providerId !== `${forced}-codex`) continue;
		const modelId = process.env.WEBSEARCH_MODEL ?? DEFAULT_MODELS[providerId];
		if (!modelId) continue;
		try {
			const m = getModel(providerId, modelId);
			if (m) {
				const key = await ctx.modelRegistry.getApiKey(m);
				if (key) return { provider: providerId, apiKey: key, model: modelId };
			}
		} catch {}
	}

	if (!forced) {
		const key = process.env.OPENAI_API_KEY;
		if (key) return { provider: "openai", apiKey: key, model: process.env.WEBSEARCH_MODEL ?? "gpt-4o" };
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function isCodexJwt(token: string): boolean {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	try {
		return !!JSON.parse(Buffer.from(parts[1]!, "base64").toString("utf8"))?.["https://api.openai.com/auth"];
	} catch {
		return false;
	}
}

function extractAccountId(token: string): string | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const id = JSON.parse(Buffer.from(parts[1]!, "base64").toString("utf8"))?.["https://api.openai.com/auth"]
			?.chatgpt_account_id;
		return typeof id === "string" && id.trim() ? id.trim() : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// OpenAI web search — returns structured results
// ---------------------------------------------------------------------------

type SearchResult = { title: string; url: string; snippet: string };

async function openaiWebSearch(query: string, model: string, apiKey: string): Promise<SearchResult[]> {
	const isOAuth = isCodexJwt(apiKey);

	const body = {
		model,
		instructions: "Perform the web search. Return a brief summary mentioning each source.",
		input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
		tools: [{ type: "web_search" }],
		include: ["web_search_call.action.sources"],
		store: false,
		stream: true,
		tool_choice: "auto",
		parallel_tool_calls: true,
	};

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"OpenAI-Beta": "responses=experimental",
	};

	let url: string;
	if (isOAuth) {
		url = "https://chatgpt.com/backend-api/codex/responses";
		const accountId = extractAccountId(apiKey);
		if (accountId) headers["chatgpt-account-id"] = accountId;
		headers["originator"] = "pi";
	} else {
		url = "https://api.openai.com/v1/responses";
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
	} catch (err) {
		clearTimeout(timeout);
		throw err;
	}

	if (!response.ok) {
		clearTimeout(timeout);
		const text = await response.text().catch(() => "");
		throw new Error(`OpenAI API error ${response.status}: ${text}`);
	}

	const responseObj = await parseSSEResponse(response);
	clearTimeout(timeout);
	return extractSearchResults(responseObj);
}

async function parseSSEResponse(response: Response): Promise<any> {
	const text = await response.text();
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.parse(trimmed);
		} catch {}
	}
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const data = line.slice(6).trim();
		if (!data || data === "[DONE]") continue;
		try {
			const parsed = JSON.parse(data);
			if (parsed.type === "response.done" || parsed.type === "response.completed") return parsed.response;
		} catch {}
	}
	throw new Error("Failed to parse OpenAI SSE response");
}

function extractSearchResults(responseObj: any): SearchResult[] {
	const output = responseObj?.output;
	if (!Array.isArray(output)) return [];

	const results: SearchResult[] = [];
	const seenUrls = new Set<string>();

	// From url_citation annotations (has title + URL)
	for (const item of output) {
		if (item.type !== "message") continue;
		for (const part of item.content ?? []) {
			for (const ann of part.annotations ?? []) {
				if (ann.type !== "url_citation" || !ann.url) continue;
				const url = ann.url.replace(/\?utm_source=openai$/, "");
				if (seenUrls.has(url)) continue;
				seenUrls.add(url);
				const snippet = extractSnippetAround(part.text ?? "", ann.start_index, ann.end_index);
				results.push({ title: ann.title ?? url, url, snippet });
			}
		}
	}

	// Backfill from web_search_call sources
	for (const item of output) {
		if (item.type !== "web_search_call") continue;
		for (const source of item.action?.sources ?? []) {
			if (!source.url) continue;
			const url = source.url.replace(/\?utm_source=openai$/, "");
			if (seenUrls.has(url)) continue;
			seenUrls.add(url);
			results.push({ title: url, url, snippet: "" });
		}
	}

	return results;
}

function extractSnippetAround(text: string, start?: number, end?: number): string {
	if (start == null || end == null || !text) return "";
	const before = Math.max(0, start - 100);
	const after = Math.min(text.length, end + 100);
	let snippet = text.slice(before, after).trim();
	snippet = snippet.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
	if (snippet.length > 300) snippet = snippet.slice(0, 297) + "...";
	return snippet;
}

// ---------------------------------------------------------------------------
// Web fetch — Readability + Turndown, Playwright fallback
// ---------------------------------------------------------------------------

/**
 * Extract readable Markdown from HTML using Readability + Turndown.
 * Returns undefined if Readability can't parse (JS-rendered page, etc).
 */
function htmlToMarkdown(html: string, url: string): { markdown: string; title: string; links: string[] } | undefined {
	const { document } = parseHTML(html);

	// Set the document URL for Readability's relative URL resolution
	try {
		Object.defineProperty(document, "baseURI", { value: url, writable: false });
	} catch {}

	const reader = new Readability(document.cloneNode(true) as any, { charThreshold: 100 });
	const article = reader.parse();

	if (!article?.content) return undefined;

	const markdown = turndown.turndown(article.content);
	const title = article.title ?? "";

	// Extract links from the article HTML
	const links: string[] = [];
	const linkRegex = /href="([^"]+)"/gi;
	let match;
	while ((match = linkRegex.exec(article.content)) !== null) {
		try {
			const resolved = new URL(match[1]!, url).href;
			if (resolved.startsWith("http")) links.push(resolved);
		} catch {}
	}

	return { markdown, title, links: [...new Set(links)] };
}

/**
 * Fetch a page with a simple HTTP request (static HTML).
 */
async function fetchStatic(url: string): Promise<{ html: string; contentType: string; finalUrl: string }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
			signal: controller.signal,
			redirect: "follow",
		});
		clearTimeout(timeout);

		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const contentType = response.headers.get("content-type") ?? "";
		const html = await response.text();
		return { html, contentType, finalUrl: response.url };
	} catch (err) {
		clearTimeout(timeout);
		throw err;
	}
}

/**
 * Fetch a JS-rendered page using Playwright headless Chromium.
 */
async function fetchWithPlaywright(url: string): Promise<string> {
	const { chromium } = await import("playwright");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(url, { waitUntil: "networkidle", timeout: FETCH_TIMEOUT_MS });
		const html = await page.content();
		return html;
	} finally {
		await browser.close();
	}
}

/**
 * Main fetch logic: try static first, fall back to Playwright if needed.
 */
async function smartFetch(
	url: string,
	usePlaywright: boolean,
): Promise<{ markdown: string; title: string; links: string[]; method: string }> {
	// 1. Try static fetch + Readability
	if (!usePlaywright) {
		const { html, contentType, finalUrl } = await fetchStatic(url);

		// Non-HTML content — return raw text
		if (!contentType.includes("html")) {
			return {
				markdown: html.length > DEFAULT_MAX_BYTES ? html.slice(0, DEFAULT_MAX_BYTES) + "\n[truncated]" : html,
				title: url,
				links: [],
				method: "static-raw",
			};
		}

		const result = htmlToMarkdown(html, finalUrl);
		if (result && result.markdown.trim().length > 200) {
			return { ...result, method: "static+readability" };
		}

		// Readability failed or returned too little — probably JS-rendered
		// Fall through to Playwright
	}

	// 2. Playwright fallback
	try {
		const html = await fetchWithPlaywright(url);
		const result = htmlToMarkdown(html, url);
		if (result) {
			return { ...result, method: "playwright+readability" };
		}

		// Last resort: basic text extraction from Playwright HTML
		const basicText = html
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return { markdown: basicText, title: url, links: [], method: "playwright-raw" };
	} catch (err: any) {
		throw new Error(`Playwright fetch failed: ${err.message}. Try with a different URL.`);
	}
}

// ---------------------------------------------------------------------------
// Test exports (pure helpers)
// ---------------------------------------------------------------------------

export const __testables = {
	isCodexJwt,
	extractAccountId,
	extractSearchResults,
	extractSnippetAround,
	htmlToMarkdown,
	parseSSEResponse,
};

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function webBrowseExtension(pi: ExtensionAPI) {
	// ---- web_search ----
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via OpenAI. Returns a list of results with title, URL, and snippet. Use web_fetch to read specific pages. Do NOT call more than 3 times in parallel (rate limit).",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const query = params.query?.trim();
			if (!query) return { content: [{ type: "text", text: "Error: empty query." }], isError: true };

			const auth = await resolveAuth(ctx);
			if (!auth) {
				return {
					content: [{ type: "text", text: "Error: No API key. Use /login (Codex) or set OPENAI_API_KEY." }],
					isError: true,
				};
			}

			onUpdate?.({ content: [{ type: "text", text: `Searching via ${auth.provider}...` }] });

			try {
				const results = await openaiWebSearch(query, auth.model, auth.apiKey);
				if (results.length === 0) {
					return { content: [{ type: "text", text: `No results found for: "${query}"` }] };
				}

				const formatted = results
					.map((r, i) => {
						let entry = `${i + 1}. ${r.title}\n   ${r.url}`;
						if (r.snippet) entry += `\n   ${r.snippet}`;
						return entry;
					})
					.join("\n\n");

				return {
					content: [{ type: "text", text: formatted }],
					details: { query, resultCount: results.length },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: `Search failed: ${err.message ?? err}` }], isError: true };
			}
		},
	});

	// ---- web_fetch ----
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a web page and extract its content as clean Markdown. Uses Mozilla Readability for article extraction and Playwright for JS-rendered pages. Returns the page text, title, and links found on the page.",
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			playwright: Type.Optional(
				Type.Boolean({ description: "Force Playwright (headless browser) for JS-heavy pages. Default: false (auto-detects)." }),
			),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const url = params.url?.trim();
			if (!url) return { content: [{ type: "text", text: "Error: empty url." }], isError: true };

			const forcePlaywright = params.playwright ?? false;

			onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

			try {
				const result = await smartFetch(url, forcePlaywright);

				// Truncate if needed
				const truncation = truncateHead(result.markdown, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let output = "";

				// Header
				if (result.title) output += `# ${result.title}\n\n`;
				output += `Source: ${url}\nExtraction: ${result.method}\n\n---\n\n`;

				// Content
				output += truncation.content;

				if (truncation.truncated) {
					output += `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
					output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
				}

				// Links found on page
				if (result.links.length > 0) {
					const topLinks = result.links.slice(0, 30);
					output += `\n\n---\n\nLinks found on page (${result.links.length} total):\n`;
					output += topLinks.map((l, i) => `${i + 1}. ${l}`).join("\n");
					if (result.links.length > 30) output += `\n... and ${result.links.length - 30} more`;
				}

				return {
					content: [{ type: "text", text: output }],
					details: { url, title: result.title, method: result.method, linkCount: result.links.length },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: `Fetch failed: ${err.message ?? err}` }], isError: true };
			}
		},
	});
}
