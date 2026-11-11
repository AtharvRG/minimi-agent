import { search as ddgSearch, SafeSearchType } from "duck-duck-scrape";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface SearchResultItem {
  query: string;
  title: string;
  url: string;
  snippet: string;
  markdownContent?: string;
  publishedDate?: string;
  provider: "tavily" | "zero-key-sift";
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

/**
 * Fetches a live webpage and extracts clean, compact Markdown using
 * Linkedom + Mozilla Readability + Turndown (SiftWeb pattern).
 */
async function scrapePageToMarkdown(url: string, timeoutMs = 4500): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return "";
    }

    const html = await res.text();
    const { document } = parseHTML(html);

    // Strip noisy tags before Readability
    document
      .querySelectorAll("script, style, noscript, nav, footer, iframe, svg")
      .forEach((el: any) => el.remove());

    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article || !article.content) return "";
    const markdown = turndown.turndown(article.content);
    return markdown.replace(/\n{3,}/g, "\n\n").slice(0, 2800).trim();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tier 1: Tavily AI Search API (if TAVILY_API_KEY is configured)
 */
async function searchViaTavily(
  query: string,
  maxResults = 3
): Promise<SearchResultItem[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("No TAVILY_API_KEY configured");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_raw_content: false,
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily HTTP ${res.status}`);
  }

  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    query,
    title: r.title || "Untitled",
    url: r.url,
    snippet: r.content || "",
    markdownContent: (r.content || "").slice(0, 2500),
    publishedDate: r.published_date || undefined,
    provider: "tavily" as const,
  }));
}

/**
 * Tier 2: Zero-Key Search Fallback (DuckDuckGo + HTML fallback + Parallel Readability/Turndown)
 */
async function searchViaZeroKey(
  query: string,
  maxResults = 3
): Promise<SearchResultItem[]> {
  let rawItems: { title: string; url: string; snippet: string }[] = [];

  try {
    const ddg = await ddgSearch(query, { safeSearch: SafeSearchType.MODERATE });
    rawItems = (ddg.results || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || "",
    }));
  } catch {
    // Fallback to DuckDuckGo Lite HTML scrape if ddg token throttles
    try {
      const htmlRes = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );
      const html = await htmlRes.text();
      const { document } = parseHTML(html);
      const nodes = Array.from(document.querySelectorAll(".result")).slice(
        0,
        maxResults
      );

      rawItems = nodes
        .map((node: any) => {
          const titleEl = node.querySelector(".result__a");
          const snippetEl = node.querySelector(".result__snippet");
          let href = titleEl?.getAttribute("href") || "";
          if (href.includes("uddg=")) {
            const match = href.match(/uddg=([^&]+)/);
            if (match) href = decodeURIComponent(match[1]);
          }
          return {
            title: titleEl?.textContent?.trim() || "Result",
            url: href,
            snippet: snippetEl?.textContent?.trim() || "",
          };
        })
        .filter((i) => i.url.startsWith("http"));
    } catch {
      rawItems = [];
    }
  }

  // Scrape full pages to Markdown in parallel
  const enriched = await Promise.all(
    rawItems.map(async (item) => {
      const md = await scrapePageToMarkdown(item.url);
      return {
        query,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        markdownContent: md || item.snippet,
        provider: "zero-key-sift" as const,
      };
    })
  );

  return enriched;
}

/**
 * Executes parallel fan-out web search across multiple sub-queries.
 */
export async function executeParallelWebSearch(
  queries: string[],
  maxResultsPerQuery = 3
): Promise<{ results: SearchResultItem[]; providerUsed: string }> {
  const uniqueQueries = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean))).slice(
    0,
    6
  );

  let providerUsed = process.env.TAVILY_API_KEY?.trim()
    ? "Tavily API"
    : "Zero-Key SiftWeb (DDG + Readability + Turndown)";

  const perQueryResults = await Promise.all(
    uniqueQueries.map(async (q) => {
      if (process.env.TAVILY_API_KEY?.trim()) {
        try {
          return await searchViaTavily(q, maxResultsPerQuery);
        } catch (err) {
          console.warn(`Tavily failed for "${q}", falling back to Zero-Key scraper:`, err);
          providerUsed = "Zero-Key Fallback (DDG + Readability)";
        }
      }
      return await searchViaZeroKey(q, maxResultsPerQuery);
    })
  );

  return {
    results: perQueryResults.flat(),
    providerUsed,
  };
}

/**
 * OpenAI-compatible Tool Definition for the Agent's ONLY tool: `web_search`
 */
export const WEB_SEARCH_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the live web and extract full page markdown content. Supports parallel fan-out queries: pass multiple focused search queries in `queries` to research several products, pricing pages, changelogs, or facts simultaneously in a single step.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description:
            "List of 1 to 5 specific search queries to execute in parallel (e.g., ['HubSpot pricing changes 2026', 'Pipedrive pricing changelog 2026']).",
        },
      },
      required: ["queries"],
    },
  },
};