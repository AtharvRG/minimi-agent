import { NextRequest, NextResponse } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  nimPool,
  DEFAULT_NIM_MODEL,
  FALLBACK_NIM_MODEL,
} from "@/lib/nim-client";
import {
  consolidateOrSaveTurn,
  retrieveEpisodicMemory,
  getAllMessages,
} from "@/lib/memory";
import {
  executeParallelWebSearch,
  WEB_SEARCH_TOOL_SCHEMA,
  SearchResultItem,
} from "@/lib/search-tool";
import { seedChallengeHistory } from "@/lib/seed-history";

export const runtime = "nodejs";

const RETIRED_NIM_MODELS = new Set(["meta/llama-3.3-70b-instruct"]);

interface MemoryGateDecision {
  should_store: boolean;
  category:
    | "pricing_snapshot"
    | "decision"
    | "fact_check"
    | "user_preference"
    | "ephemeral";
  reason: string;
  storageAction?: "inserted" | "consolidated" | "skipped";
  consolidatedIntoId?: number;
  similarityScore?: number;
}

/**
 * Deterministic sanitizer that removes all Unicode emoji presentation characters
 * to guarantee strict professional output.
 */
function stripEmojis(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s{3,}/g, " ")
    .trim();
}

function parseMemoryGate(
  userPrompt: string,
  rawAssistantReply: string
): { cleanReply: string; gate: MemoryGateDecision } {
  const regex = /<memory_gate>\s*([\s\S]*?)\s*<\/memory_gate>/i;
  const match = rawAssistantReply.match(regex);
  const withoutGate = rawAssistantReply.replace(regex, "").trim();
  const cleanReply = stripEmojis(withoutGate);

  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1]) as Partial<MemoryGateDecision>;
      return {
        cleanReply,
        gate: {
          should_store: Boolean(parsed.should_store),
          category: parsed.category || "fact_check",
          reason: stripEmojis(parsed.reason || "Evaluated by inline memory gate"),
        },
      };
    } catch {
      // Fall through to deterministic heuristic fallback
    }
  }

  const trimmed = userPrompt.trim().toLowerCase();
  const isChitchat =
    trimmed.length < 15 &&
    /^(hi|hey|hello|sup|yo|thanks|thank you|ok|okay|cool|nice|bye|test)\b/.test(
      trimmed
    );

  return {
    cleanReply,
    gate: {
      should_store: !isChitchat,
      category: isChitchat ? "ephemeral" : "fact_check",
      reason: isChitchat
        ? "Short greeting/chitchat filtered out"
        : "Substantive query stored in episodic memory",
    },
  };
}

export async function GET() {
  await seedChallengeHistory(false);
  const messages = getAllMessages(100);
  return NextResponse.json({ messages });
}

export async function DELETE() {
  const res = await seedChallengeHistory(true);
  const messages = getAllMessages(100);
  return NextResponse.json({ reset: true, ...res, messages });
}

export async function POST(req: NextRequest) {
  await seedChallengeHistory(false);

  const body = (await req.json()) as {
    message?: string;
    model?: string;
    webSearch?: boolean;
    sessionId?: string;
    customTimestamp?: string;
  };

  const {
    message,
    model: requestedModel,
    sessionId = "active-session",
    customTimestamp,
  } = body;

  const requestedModelName = requestedModel?.trim();
  const activeModel =
    requestedModelName && !RETIRED_NIM_MODELS.has(requestedModelName)
      ? requestedModelName
      : requestedModelName
        ? FALLBACK_NIM_MODEL
        : DEFAULT_NIM_MODEL;

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const now = customTimestamp ? new Date(customTimestamp) : new Date();

        // 1. Retrieve Episodic Memory BEFORE running the LLM
        sendEvent({
          type: "status",
          step: "memory",
          detail:
            "Scanning temporal index (chrono-node), SQLite FTS5 keywords, and Granite-R2 embeddings",
        });

        const { memories, telemetry } = await retrieveEpisodicMemory(message, now);

        if (memories.length > 0) {
          sendEvent({
            type: "memory",
            count: memories.length,
            telemetry,
            items: memories.map((m) => ({
              id: m.id,
              role: m.role,
              created_at: m.created_at,
              matchReason: m.matchReason,
              preview: m.content.slice(0, 140),
            })),
          });
        }

        const memoryContextBlock =
          memories.length > 0
            ? memories
                .map(
                  (m) =>
                    `[${new Date(m.created_at).toUTCString()} | ISO: ${m.created_at.split("T")[0]} | Match: ${m.matchReason}] ${m.role.toUpperCase()}: ${m.content}`
                )
                .join("\n\n---\n\n")
            : "No matching historical conversations found.";

        const systemPrompt = `You are minimi, a high-precision technical research chat agent with a single tool: \`web_search\`.
Current Timestamp: ${now.toUTCString()} (ISO Date: ${now.toISOString().split("T")[0]}, Day of Week: ${now.toLocaleDateString("en-US", { weekday: "long" })}).

### EPISODIC MEMORY FROM PAST CONVERSATIONS
Below are relevant past conversation turns retrieved automatically from local SQLite storage with their exact timestamps:
<episodic_memory>
${memoryContextBlock}
</episodic_memory>

### STRICT OPERATING PRINCIPLES
1. **NO EMOJIS**: Never output any emojis, emoticons, or decorative symbols under any circumstances. Maintain a rigorous, objective, technical tone.
2. **Temporal & Diffing Queries**: When the user asks about a past date (e.g., "On Monday we shortlisted 5 CRM tools...", "What did I ask you on 3 November?", "Last Tuesday I asked about Postgres hosting..."):
   - Identify the exact items, numbers, or claims stored in \`<episodic_memory>\` for that date.
   - Call \`web_search\` with **parallel sub-queries** (\`queries: [...] \`) to check the live current pricing, changelogs, or facts as of today (${now.toISOString().split("T")[0]}).
   - Compare the historical baseline from memory against today's live web search results using clean Markdown tables or bullet points, explicitly stating what changed and what remained unchanged.
3. **Parallel Fan-Out Search**: Whenever you need to verify multiple products or facts, batch them into a SINGLE \`web_search\` tool call using the \`queries\` array so they execute concurrently.
4. **Numbered Inline Citations**: Whenever you reference facts from \`web_search\` results, cite them inline using numbered brackets like [1], [2], [3] corresponding to the Source [N] index returned by the tool.
5. **Autonomous Episodic Memory Gate (MANDATORY AT END OF FINAL RESPONSE)**:
   At the very end of your final response, append a \`<memory_gate>\` JSON block deciding whether this turn contains durable information worth saving to long-term SQLite memory:
   - Set \`"should_store": true\` for: product shortlists, pricing baselines, technical research, dated questions, team constraints, or factual answers that could be referenced in the future.
   - Set \`"should_store": false\` for: casual greetings ("hi", "hello"), thank-yous ("thanks", "cool"), meta-chitchat, or empty banter.
   Format strictly at the very end:
   <memory_gate>{"should_store": true, "category": "pricing_snapshot", "reason": "Contains dated CRM pricing comparison"}</memory_gate>`;

        const llmMessages: ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ];

        const allCollectedSources: SearchResultItem[] = [];
        const reasoningTraceParts: string[] = [];

        if (memories.length > 0) {
          reasoningTraceParts.push(
            `Recalled ${memories.length} episodic memory turn(s) via ${telemetry.join(", ")}.`
          );
        } else {
          reasoningTraceParts.push(
            "Scanned local SQLite temporal and vector indices; no prior historical baseline required."
          );
        }

        const MAX_TOOL_STEPS = 3;

        for (let step = 1; step <= MAX_TOOL_STEPS; step++) {
          const { client, rpmUsed, keyIndex } = await nimPool.acquireClient();

          sendEvent({
            type: "status",
            step: "llm",
            detail: `Executing NVIDIA NIM (${activeModel}) [Key #${keyIndex} | ${rpmUsed}/38 RPM]`,
          });

          const response = await client.chat.completions.create({
            model: activeModel,
            messages: llmMessages,
            tools: [WEB_SEARCH_TOOL_SCHEMA],
            tool_choice: "auto",
            temperature: 0.2,
            max_tokens: 2048,
          });

          const choice = response.choices[0]?.message;
          if (!choice) {
            throw new Error("Empty response from NVIDIA NIM");
          }

          // Capture reasoning_content if returned by reasoning-capable NIM models
          const rawReasoning = (
            choice as unknown as { reasoning_content?: string }
          ).reasoning_content;
          if (rawReasoning) {
            const cleanedReasoning = stripEmojis(rawReasoning);
            reasoningTraceParts.push(cleanedReasoning);
            sendEvent({
              type: "reasoning",
              text: reasoningTraceParts.join("\n\n"),
            });
          }

          llmMessages.push(choice);

          if (choice.tool_calls && choice.tool_calls.length > 0) {
            for (const toolCall of choice.tool_calls) {
              if (
                toolCall.type === "function" &&
                toolCall.function.name === "web_search"
              ) {
                let parsedArgs: { queries?: string[] } = {};
                try {
                  parsedArgs = JSON.parse(
                    toolCall.function.arguments || "{}"
                  ) as { queries?: string[] };
                } catch {
                  parsedArgs = { queries: [message] };
                }

                const queries =
                  Array.isArray(parsedArgs.queries) &&
                  parsedArgs.queries.length > 0
                    ? parsedArgs.queries
                    : [message];

                reasoningTraceParts.push(
                  `Step ${step}: Dispatched parallel web_search fan-out across ${queries.length} query target(s): ${queries.map((q) => `"${q}"`).join(", ")}.`
                );

                sendEvent({
                  type: "reasoning",
                  text: reasoningTraceParts.join("\n\n"),
                });

                sendEvent({
                  type: "search_start",
                  step,
                  queries,
                });

                const { results, providerUsed } = await executeParallelWebSearch(
                  queries,
                  3
                );
                const startIdx = allCollectedSources.length;
                allCollectedSources.push(...results);

                reasoningTraceParts.push(
                  `Step ${step} Complete: Extracted ${results.length} live Markdown document(s) via ${providerUsed}. Cross-referencing against episodic baseline.`
                );

                sendEvent({
                  type: "reasoning",
                  text: reasoningTraceParts.join("\n\n"),
                });

                sendEvent({
                  type: "search_complete",
                  step,
                  provider: providerUsed,
                  resultCount: results.length,
                  sources: results.map((r, i) => ({
                    number: String(startIdx + i + 1),
                    title: r.title,
                    url: r.url,
                    query: r.query,
                    snippet: r.snippet,
                    quote: (r.markdownContent || r.snippet || "").slice(0, 220),
                    provider: r.provider,
                  })),
                });

                const formattedResults =
                  results.length > 0
                    ? results
                        .map(
                          (r, idx) =>
                            `Source [${startIdx + idx + 1}] (Query: "${r.query}")\nTitle: ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate || "Live page"}\nContent:\n${r.markdownContent || r.snippet}`
                        )
                        .join("\n\n====================\n\n")
                    : "No results found. Try broader search terms.";

                llmMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: formattedResults,
                });
              }
            }
            continue;
          }

          // Final Answer reached: Parse <memory_gate> and run Semantic Deduplication
          const rawContent = choice.content || "No response generated.";
          const { cleanReply, gate } = parseMemoryGate(message, rawContent);

          if (gate.should_store) {
            const consolidation = await consolidateOrSaveTurn({
              sessionId,
              userContent: stripEmojis(message),
              assistantContent: cleanReply,
              sources: allCollectedSources,
              createdAt: now.toISOString(),
            });

            gate.storageAction = consolidation.action;
            gate.consolidatedIntoId = consolidation.userRowId;
            gate.similarityScore = consolidation.similarityScore;

            if (consolidation.action === "consolidated") {
              gate.reason = `Consolidated into memory #${consolidation.userRowId} (${consolidation.similarityScore}% semantic intent match)`;
            }
          } else {
            gate.storageAction = "skipped";
          }

          sendEvent({
            type: "memory_gate",
            gate,
          });

          sendEvent({
            type: "answer",
            content: cleanReply,
            reasoning: reasoningTraceParts.join("\n\n"),
            sources: allCollectedSources.map((r, i) => ({
              number: String(i + 1),
              title: r.title,
              url: r.url,
              query: r.query,
              snippet: r.snippet,
              quote: (r.markdownContent || r.snippet || "").slice(0, 220),
              provider: r.provider,
            })),
          });

          break;
        }

        sendEvent({ type: "done" });
      } catch (err: unknown) {
        console.error("Agent error:", err);
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Unexpected error in chat agent.";
        sendEvent({
          type: "error",
          message: stripEmojis(errorMessage),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}