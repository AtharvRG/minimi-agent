# minimi Chat Agent - Architecture & Design (`DESIGN.md`)

## 1. The Core Insight: Why Standard Web-Search Wrappers Fail This Dataset

Inspecting the evaluation dataset reveals a multi-part architectural problem disguised as a simple prompt:

- *"On Monday I shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"*
- *"What did I ask you on 3 November? Is your answer still correct today?"*
- *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"*

A naive LLM wrapper with a `web_search` tool fails these prompts for three reasons:

1. **The Single-Tool Constraint vs. Episodic Recall**: The specification mandates **one tool: `web_search`**. Exposing a second `search_memory` tool violates the constraint and wastes an extra LLM round-trip. Historical context must be resolved deterministically *before* the tool-calling loop begins.
2. **Why Pure Vector RAG Fails Temporal Queries**: The semantic cosine similarity between *"What did I ask you on 3 November?"* and the actual question asked on Nov 3 (*"What is the latest stable version of Next.js..."*) is near zero.
3. **Temporal Snapshot Diffing**: Live web search only reveals what a price is *today*. Answering *"Has any pricing changed since Last Tuesday?"* requires retrieving Tuesday's stored baseline and diffing it against today's live pricing page.

---

## 2. How It Works (System Architecture)

```text
User Prompt ──► [1. 3-Layer Hybrid Memory Pre-Processor (SQLite WAL, ~15ms, 0 API calls)]
                    ├─ Layer 1: Temporal Index (chrono-node → ISO date window)
                    ├─ Layer 2: Lexical Index (SQLite FTS5 BM25 keyword match)
                    └─ Layer 3: Semantic Index (Local quantized IBM Granite-R2 ONNX 384-d vectors)
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
                [4. Dual-Tier Search & Markdown Extraction Pipeline]
                    ├─ Tier 1: Tavily AI Search API (if TAVILY_API_KEY is configured)
                    └─ Tier 2: Zero-Key SiftWeb Fallback (DuckDuckGo + Linkedom + Readability + Turndown)
                            │
                            ▼
                [5. Inline Cognitive Memory Gate + Semantic Upsert Consolidation]
                    ├─ Filters out ephemeral chitchat (<memory_gate> JSON evaluation in 0 extra API calls)
                    └─ Deduplicates repeated/paraphrased queries (cosine + token overlap >= 0.82) in-place
```

### A. 3-Layer Hybrid Episodic Memory (`src/lib/memory.ts` & `src/lib/embedder.ts`)

Before calling the LLM, a deterministic pre-processor scores historical turns stored in local SQLite (`data/agent.db`) across three orthogonal signals:

1. **Temporal Layer (`chrono-node`)**: Parses relative and absolute dates (*"On Monday"*, *"3 November"*, *"Last Tuesday"*) relative to the active reference clock and queries SQLite's `idx_messages_created_at` B-tree index (`+10.0` weight).
2. **Lexical Layer (SQLite FTS5)**: Executes BM25 keyword matching on domain entities (*"CRM"*, *"Postgres"*) (`+4.0` weight).
3. **Semantic Layer (Local IBM Granite R2 ONNX)**: Runs `onnx-community/granite-embedding-small-english-r2-ONNX` (`q8` quantized, 384-dim) locally on CPU in ~12ms via `@huggingface/transformers`—consuming **0 external API calls** and **0 NIM rate-limit quota**.

### B. Autonomous Cognitive Memory Gate & Semantic Deduplication (`consolidateOrSaveTurn`)

Blindly saving every turn pollutes long-term memory with greetings (*"hey"*, *"thanks"*) or duplicate verification queries.

- **Zero-RPM Inline Memory Gate**: The model appends a structured `<memory_gate>` decision block at the end of its final response (`should_store`, `category`, `reason`). The server strips this block before rendering and skips persisting ephemeral turns without needing a second LLM call.
- **Semantic Upsert Consolidation**: When `should_store: true`, the engine compares the new prompt's Granite-R2 vector and token overlap against prior user turns on the same date window. If similarity `>= 0.82` (e.g., a repeated or reworded prompt), it **consolidates (upserts) the existing User + Assistant pair in-place** rather than appending duplicate rows, while protecting historical baseline seeds on past dates.

### C. Parallel Fan-Out `web_search` with Dual-Tier Fallback (`src/lib/search-tool.ts`)

- **Single-Roundtrip Fan-Out**: `web_search` accepts `queries: string[]` (up to 5 concurrent sub-queries). Checking 5 CRM tools executes in parallel via `Promise.all()`, cutting multi-entity research latency from ~18s down to ~2s and saving 4 LLM round-trips.
- **Zero-Key Resilience**: Uses Tavily API when `TAVILY_API_KEY` is present, and automatically falls back to a zero-key local scraper (`duck-duck-scrape` + parallel HTML fetch + `@mozilla/readability` + `turndown` Markdown conversion) so `npm run dev` works out-of-the-box with only an LLM key.

### D. NVIDIA NIM 38-RPM Sliding-Window Guard (`src/lib/nim-client.ts`)

NVIDIA NIM enforces a strict **40 RPM** limit. Our client pool tracks request timestamps in a 60-second sliding window capped at **38 RPM per key**, rotating across comma-separated keys (`NVIDIA_API_KEYS`) or queuing briefly in-memory so multi-step tool loops never crash with `HTTP 429`.

---

## 3. What I Considered and Rejected

1. **Exposing a Second `search_memory` or `save_memory` Tool (Rejected)**: Violates the single-tool rule (`web_search` only) and costs 1–2 extra LLM round-trips per turn (+2s latency and +2 RPM). Pre-processing retrieval and piggybacking `<memory_gate>` on the final response achieves full episodic memory in **0 extra API calls**.
2. **Cloud Embedding APIs for Memory (Rejected)**: Calling remote embedding endpoints on every turn burns rate-limit quota and adds network latency. Local quantized **IBM Granite R2 ONNX** runs in ~12ms on CPU with <150MB RAM.
3. **Appending Every Verification Turn to SQLite (Rejected)**: Repeatedly clicking or rephrasing a benchmark prompt floods the database with near-identical rows. Semantic upsert consolidation keeps memory high-signal and compact.
4. **Heavy Agent Frameworks like LangChain (Rejected)**: Opaque abstractions obscure prompt assembly and streaming telemetry. A ~150-line native TypeScript loop over the OpenAI-compatible SDK streams granular NDJSON events (`memory` → `reasoning` → `search_start` → `search_complete` → `memory_gate` → `answer`) to the UI's `ChainOfThought`, scrollable `Reasoning`, and Portal-rendered `InlineCitation` components.

---

## 4. What I Would Build With Another Week

1. **Token-Level SSE Streaming with Incremental Citation Resolution**: Stream final synthesis tokens character-by-character (`stream: true`) while resolving `[N]` citation pills on the fly for sub-300ms time-to-first-token.
2. **Structured Entity-Metric Fact Ledger**: Extract normalized `(entity, metric, value, as_of_date, source_url)` tuples into a dedicated SQLite table alongside conversational turns for deterministic numeric diffing.
3. **Headless Browser Fallback for Client-Rendered Pricing SPAs**: Trigger a lightweight Playwright fallback when Readability extracts `<200` characters on JS-heavy SaaS pricing tables.
4. **Automated Evaluation Harness (`npm run eval`)**: A deterministic test runner that seeds synthetic multi-day histories, executes 50 temporal + live-web verification queries, and scores citation accuracy and latency.
