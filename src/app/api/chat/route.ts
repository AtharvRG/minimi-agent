import { NextRequest, NextResponse } from "next/server";
import { nimPool, DEFAULT_NIM_MODEL } from "@/lib/nim-client";
import {
  saveMessage,
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

  const body = await req.json();
  const {
    message,
    sessionId = "active-session",
    customTimestamp,
  }: {
    message: string;
    sessionId?: string;
    customTimestamp?: string;
  } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: Record<string, any>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const now = customTimestamp ? new Date(customTimestamp) : new Date();

        // 1. Retrieve Episodic Memory BEFORE saving current message
        sendEvent({
          type: "status",
          step: "memory",
          detail: "Scanning temporal index (chrono), FTS5 keywords & Granite-R2 embeddings...",
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

        // Save the user's message to SQLite
        await saveMessage({
          sessionId,
          role: "user",
          content: message,
          createdAt: now.toISOString(),
        });

        // Build temporal context block
        const memoryContextBlock =
          memories.length > 0
            ? memories
                .map(
                  (m) =>
                    `[${new Date(m.created_at).toUTCString()} | ISO: ${m.created_at.split("T")[0]} | Match: ${m.matchReason}] ${m.role.toUpperCase()}: ${m.content}`
                )
                .join("\n\n---\n\n")
            : "No matching historical conversations found.";

        const systemPrompt = `You are minimi, a fast, high-precision research chat agent with a single tool: \`web_search\`.
Current Timestamp: ${now.toUTCString()} (ISO Date: ${now.toISOString().split("T")[0]}, Day of Week: ${now.toLocaleDateString("en-US", { weekday: "long" })}).

### EPISODIC MEMORY FROM PAST CONVERSATIONS
Below are relevant past conversation turns retrieved automatically from local storage with their exact timestamps:
<episodic_memory>
${memoryContextBlock}
</episodic_memory>

### OPERATING PRINCIPLES
1. **Temporal & Diffing Queries**: When the user asks about a past date (e.g., "On Monday we shortlisted 5 CRM tools...", "What did I ask you on 3 November?", "Last Tuesday I asked about Postgres hosting..."):
   - First, identify the exact items, numbers, or claims stored in \`<episodic_memory>\` for that date.
   - Next, call \`web_search\` with **parallel sub-queries** (\`queries: [...] \`) to check the live current pricing, changelogs, or facts as of today (${now.toISOString().split("T")[0]}).
   - Compare the historical baseline from memory against today's live web search results and explicitly state what changed and what stayed the same.
2. **Parallel Fan-Out Search**: Whenever you need to verify multiple products or facts (e.g., 5 CRM tools or 4 Postgres hosts), batch them into a SINGLE \`web_search\` tool call using the \`queries\` array so they execute in parallel.
3. **Citations**: Cite live sources inline using Markdown links like [Source Title](url) or [1], and be concise, structured, and direct.`;

        const llmMessages: any[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ];

        const allCollectedSources: SearchResultItem[] = [];
        const MAX_TOOL_STEPS = 3;

        for (let step = 1; step <= MAX_TOOL_STEPS; step++) {
          const { client, rpmUsed, keyIndex } = await nimPool.acquireClient();

          sendEvent({
            type: "status",
            step: "llm",
            detail: `Calling NVIDIA NIM (${DEFAULT_NIM_MODEL}) [Key #${keyIndex} • ${rpmUsed}/38 RPM]...`,
          });

          const response = await client.chat.completions.create({
            model: DEFAULT_NIM_MODEL,
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

          llmMessages.push(choice);

          // Check if the model invoked `web_search`
          if (choice.tool_calls && choice.tool_calls.length > 0) {
            for (const toolCall of choice.tool_calls) {
              if (toolCall.function.name === "web_search") {
                let parsedArgs: { queries?: string[] } = {};
                try {
                  parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
                } catch {
                  parsedArgs = { queries: [message] };
                }

                const queries =
                  Array.isArray(parsedArgs.queries) && parsedArgs.queries.length > 0
                    ? parsedArgs.queries
                    : [message];

                sendEvent({
                  type: "search_start",
                  step,
                  queries,
                });

                const { results, providerUsed } = await executeParallelWebSearch(
                  queries,
                  3
                );
                allCollectedSources.push(...results);

                sendEvent({
                  type: "search_complete",
                  step,
                  provider: providerUsed,
                  resultCount: results.length,
                  sources: results.map((r) => ({
                    title: r.title,
                    url: r.url,
                    query: r.query,
                    provider: r.provider,
                  })),
                });

                const formattedResults =
                  results.length > 0
                    ? results
                        .map(
                          (r, idx) =>
                            `Source [${idx + 1}] (Query: "${r.query}")\nTitle: ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate || "Live page"}\nContent:\n${r.markdownContent || r.snippet}`
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
            // Continue loop so LLM synthesizes tool results
            continue;
          }

          // No tool calls -> We have the final answer! Stream it out and save to SQLite.
          const finalContent = choice.content || "No response generated.";

          sendEvent({
            type: "answer",
            content: finalContent,
            sources: allCollectedSources,
          });

          await saveMessage({
            sessionId,
            role: "assistant",
            content: finalContent,
            sources: allCollectedSources,
            createdAt: new Date(now.getTime() + 1000).toISOString(),
          });

          break;
        }

        sendEvent({ type: "done" });
      } catch (err: any) {
        console.error("Agent error:", err);
        sendEvent({
          type: "error",
          message: err?.message || "Unexpected error in chat agent.",
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