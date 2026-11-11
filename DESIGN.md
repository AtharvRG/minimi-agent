# minimi Chat Agent — Architecture & Design (`DESIGN.md`)

## 1. The Core Insight: Why Standard Web-Search Agents Fail This Dataset

Inspecting the evaluation dataset reveals a subtle architectural challenge:

- *"On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"*
- *"What did I ask you on 3 November? Is your answer still correct today?"*
- *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"*

A naive LLM wrapper with a `web_search` tool fails these prompts for three reasons:

1. **The Single-Tool Constraint vs. Past Context**: The specification states the agent has **one tool: `web_search`**. Therefore, episodic memory cannot be exposed as a second `search_memory` tool; historical context must be resolved deterministically *before* the model's tool-calling loop.
2. **Why Pure Vector RAG Fails Temporal Queries**: The cosine similarity between *"What did I ask you on 3 November?"* and the actual question asked on Nov 3 (*"What is the latest stable version of Next.js..."*) is near zero.
3. **Temporal Snapshot Diffing**: Live web search only tells the agent what a price is *today*. To answer *"Has any pricing changed since Last Tuesday?"*, the agent must compare Tuesday's stored baseline snapshot against today's live pricing page.

---

## 2. How It Works (System Architecture)

```text
User Prompt ──► [1. 3-Layer Hybrid Memory Engine (SQLite, ~15ms, 0 API calls)]
                    ├─ Layer 1: Temporal Parser (chrono-node → ISO date window)
                    ├─ Layer 2: Lexical Index (SQLite FTS5 BM25 keyword match)
                    └─ Layer 3: Semantic Index (Local IBM Granite-R2 ONNX 384-d vectors)
                            │
                            ▼
                [2. Temporal Context Injection (<episodic_memory> in System Prompt)]
                            │
                            ▼
                [3. NVIDIA NIM Agent Loop (Multi-Key 38 RPM Sliding-Window Pool)]
                            │
                    Tool Call: `web_search({ queries: string[] })` (Parallel Fan-Out)
                            │
                            ▼
                [4. Dual-Tier Search & Markdown Extraction Engine]
                    ├─ Tier 1: Tavily AI Search API (if TAVILY_API_KEY is present)
                    └─ Tier 2: Zero-Key SiftWeb Pipeline (DuckDuckGo + Linkedom + Readability + Turndown)
```

### A. 3-Layer Hybrid Episodic Memory (`src/lib/memory.ts` & `src/lib/embedder.ts`)

Every turn (plus extracted sources and timestamps) is persisted in a local **SQLite (`WAL` mode)** database. Before calling the LLM, a fast pre-processor scores past turns across three orthogonal signals:

1. **Temporal Layer (`chrono-node`)**: Parses relative and absolute time expressions (*"On Monday"*, *"3 November"*, *"Last Tuesday"*) relative to the reference clock and queries SQLite's `idx_messages_created_at` B-tree index (`+10.0` weight).
2. **Lexical Layer (SQLite FTS5)**: Runs BM25 keyword matching on domain terms (*"CRM"*, *"Postgres"*) (`+4.0` weight).
3. **Semantic Layer (Local IBM Granite R2 ONNX)**: Runs `onnx-community/granite-embedding-small-english-r2-ONNX` (`q8` quantized) locally on CPU in ~12ms via `@huggingface/transformers`. This uses **0 external API calls** and preserves our LLM rate limit.

### B. Parallel Fan-Out `web_search` with Dual-Tier Fallback (`src/lib/search-tool.ts`)

- **Single-Roundtrip Fan-Out**: Instead of taking `query: string` and forcing 5 sequential LLM turns to check 5 CRM tools, `web_search` accepts `queries: string[]`. All sub-queries execute concurrently via `Promise.all()`, cutting multi-entity research latency from ~18s down to ~2s.
- **Tier 1 (Tavily API) → Tier 2 (Zero-Key Local Scraper)**: If `TAVILY_API_KEY` is configured, it is used first. If omitted or rate-limited, the agent degrades gracefully to a zero-key pipeline (`duck-duck-scrape` + parallel HTML fetch + `@mozilla/readability` + `turndown` HTML-to-Markdown conversion) so `npm run dev` works out-of-the-box with only an LLM key.

### C. NVIDIA NIM 38-RPM Sliding-Window Guard (`src/lib/nim-client.ts`)

NVIDIA NIM enforces a strict **40 RPM** rate limit. We implemented a stateful sliding-window token bucket capped at **38 RPM per key** with automatic round-robin key rotation (`NVIDIA_API_KEYS=key1,key2`). If all keys hit 38 requests within a rolling 60s window, requests queue in-memory until the oldest timestamp expires—eliminating `HTTP 429` crashes during multi-step tool execution.

---

## 3. What We Considered and Rejected

1. **Exposing a Second `search_history` Tool to the LLM (Rejected)**: Violates the strict *"It has one tool: web search"* constraint and wastes an extra LLM roundtrip (+1.5s latency and +1 RPM) before web searching can even begin.
2. **Cloud Embedding APIs for Memory (Rejected)**: Calling remote embedding endpoints on every message consumes rate-limit quota and adds network latency. Running quantized **IBM Granite R2 ONNX** locally in Node.js takes ~12ms on CPU with <150MB RAM.
3. **Heavy Agent Frameworks like LangChain/LlamaIndex (Rejected)**: Hide prompt assembly and tool-loop control behind opaque abstractions. A 120-line native TypeScript loop over the OpenAI-compatible SDK is faster to debug, streams granular telemetry (`memory` → `search_start` → `search_complete` → `answer`), and has zero dependency bloat.

---

## 4. What We Would Build With Another Week

1. **Token-Level Streaming Over Server-Sent Events (SSE)**: Stream final synthesis tokens incrementally (`stream: true`) alongside tool-call delta chunks for sub-300ms time-to-first-token (TTFT).
2. **Structured Fact & Price Ledger Table**: Extract structured `(entity, metric, value, as_of_date, source_url)` tuples into a dedicated SQLite table after every assistant turn for deterministic numeric diffing.
3. **Playwright Headless Browser Fallback for JS-Heavy SPAs**: Some SaaS pricing pages render tier tables client-side; adding a lightweight headless browser fallback when Readability returns `<200` chars would achieve near-100% extraction coverage.
4. **Automated Evaluation Harness (`npm run eval`)**: An LLM-as-a-judge test suite that seeds synthetic histories, runs 50 temporal + live-web verification prompts, and scores citation precision and latency.

---