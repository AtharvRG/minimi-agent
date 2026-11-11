"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Send,
  Database,
  Clock,
  RotateCcw,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Loader2,
} from "lucide-react";

interface TelemetryTrace {
  memories?: {
    id: number;
    role: string;
    created_at: string;
    matchReason: string;
    preview: string;
  }[];
  memoryTelemetry?: string[];
  searches?: {
    queries: string[];
    provider?: string;
    sources?: { title: string; url: string; query: string }[];
  }[];
  statusLog: string[];
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: { title: string; url: string; query?: string }[];
  trace?: TelemetryTrace;
}

const CHALLENGE_PROMPTS = [
  "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
  "What did I ask you on 3 November? Is your answer still correct today?",
  "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
];

export default function ChatAgentPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [backdateInput, setBackdateInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function fetchHistory() {
    const res = await fetch("/api/chat");
    const data = await res.json();
    if (data.messages) {
      setMessages(
        data.messages.map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          sources: JSON.parse(m.sources_json || "[]"),
        }))
      );
    }
  }

  async function handleResetSeed() {
    setLoading(true);
    const res = await fetch("/api/chat", { method: "DELETE" });
    const data = await res.json();
    if (data.messages) {
      setMessages(
        data.messages.map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          sources: JSON.parse(m.sources_json || "[]"),
        }))
      );
    }
    setLoading(false);
  }

  async function sendMessage(promptText?: string) {
    const text = (promptText ?? input).trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      created_at: backdateInput
        ? new Date(backdateInput).toISOString()
        : new Date().toISOString(),
    };

    const assistantId = `assistant-${Date.now()}`;
    const initialTrace: TelemetryTrace = {
      memories: [],
      memoryTelemetry: [],
      searches: [],
      statusLog: [],
    };

    setMessages((prev) => [
      ...prev,
      userTurn,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
        trace: initialTrace,
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          customTimestamp: backdateInput ? new Date(backdateInput).toISOString() : undefined,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              const trace: TelemetryTrace = {
                memories: [...(m.trace?.memories || [])],
                memoryTelemetry: [...(m.trace?.memoryTelemetry || [])],
                searches: [...(m.trace?.searches || [])],
                statusLog: [...(m.trace?.statusLog || [])],
              };

              if (event.type === "status") {
                trace.statusLog.push(event.detail);
              } else if (event.type === "memory") {
                trace.memories = event.items;
                trace.memoryTelemetry = event.telemetry;
              } else if (event.type === "search_start") {
                trace.searches?.push({ queries: event.queries });
              } else if (event.type === "search_complete") {
                const lastIdx = (trace.searches?.length || 1) - 1;
                if (trace.searches && trace.searches[lastIdx]) {
                  trace.searches[lastIdx] = {
                    ...trace.searches[lastIdx],
                    provider: event.provider,
                    sources: event.sources,
                  };
                }
              } else if (event.type === "answer") {
                return {
                  ...m,
                  content: event.content,
                  sources: event.sources,
                  trace,
                };
              } else if (event.type === "error") {
                return {
                  ...m,
                  content: `⚠️ Error: ${event.message}`,
                  trace,
                };
              }

              return { ...m, trace };
            })
          );
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
            m
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight flex items-center gap-2">
              minimi web-search agent
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-normal">
                NIM 38-RPM Guard + Granite-R2 Hybrid Memory
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Reviewer Time-Travel Backdate Input */}
          <div className="hidden md:flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-400">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Simulate Date:</span>
            <input
              type="date"
              value={backdateInput}
              onChange={(e) => setBackdateInput(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none text-xs"
            />
            {backdateInput && (
              <button
                onClick={() => setBackdateInput("")}
                className="text-zinc-500 hover:text-zinc-300 ml-1"
              >
                ✕
              </button>
            )}
          </div>

          <button
            onClick={() => setShowHistoryModal(!showHistoryModal)}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 flex items-center gap-1.5 transition"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            SQLite Memory ({messages.length})
          </button>

          <button
            onClick={handleResetSeed}
            title="Reset & re-seed the 3 challenge test conversations (Monday, Nov 3, Last Tuesday)"
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 flex items-center gap-1.5 text-zinc-300 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Seed Data
          </button>
        </div>
      </header>

      {/* Main Chat Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Quick Challenge Test Prompts Banner */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
          <div className="text-xs font-medium text-zinc-400 mb-2.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Minimi Evaluation Dataset — Click any prompt to test Temporal Memory + Parallel Live Search:
          </div>
          <div className="grid grid-cols-1 gap-2">
            {CHALLENGE_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                className="text-left text-xs px-3.5 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/90 hover:border-emerald-500/40 hover:bg-zinc-900 text-zinc-200 transition flex items-center justify-between group"
              >
                <span>“{prompt}”</span>
                <span className="text-emerald-400 opacity-0 group-hover:opacity-100 transition text-[11px] font-medium ml-2 shrink-0">
                  Run Test →
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation Feed */}
        <div className="flex flex-col gap-4">
          {messages.map((m) => {
            const dateStr = new Date(m.created_at).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            return (
              <div
                key={m.id}
                className={`flex flex-col gap-2 rounded-xl p-4 border ${
                  m.role === "user"
                    ? "bg-zinc-900/70 border-zinc-800 ml-8"
                    : "bg-zinc-900/30 border-zinc-800/60 mr-4"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="font-semibold uppercase tracking-wider text-zinc-300">
                    {m.role === "user" ? "You" : "minimi Agent"}
                  </span>
                  <span className="font-mono text-zinc-500">{dateStr}</span>
                </div>

                {/* Live Agent Telemetry Box (Memory + Parallel Web Search) */}
                {m.trace &&
                  (m.trace.memories?.length ||
                    m.trace.searches?.length ||
                    m.trace.statusLog.length > 0) && (
                    <div className="rounded-lg bg-zinc-950/90 border border-zinc-800/80 p-3 text-xs space-y-2 my-1">
                      {/* Episodic Memory Recall */}
                      {m.trace.memories && m.trace.memories.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-emerald-400 font-medium flex items-center gap-1.5">
                            <Database className="w-3.5 h-3.5" />
                            Episodic Memory Recalled ({m.trace.memories.length} past turns)
                          </div>
                          <div className="text-[11px] text-zinc-400 pl-5 space-y-0.5">
                            {m.trace.memoryTelemetry?.map((t, idx) => (
                              <div key={idx}>• {t}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Parallel Web Search Execution */}
                      {m.trace.searches &&
                        m.trace.searches.map((s, idx) => (
                          <div key={idx} className="space-y-1 pt-1 border-t border-zinc-900">
                            <div className="text-sky-400 font-medium flex items-center gap-1.5">
                              <Search className="w-3.5 h-3.5" />
                              Tool Call: <code className="font-mono">web_search</code> ({s.queries.length} parallel queries)
                              {s.provider && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                  {s.provider}
                                </span>
                              )}
                            </div>
                            <div className="pl-5 flex flex-wrap gap-1.5">
                              {s.queries.map((q, qIdx) => (
                                <span
                                  key={qIdx}
                                  className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300"
                                >
                                  🔍 {q}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}

                      {/* Status indicator while running */}
                      {!m.content && m.trace.statusLog.length > 0 && (
                        <div className="flex items-center gap-2 text-zinc-400 pt-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          <span>{m.trace.statusLog[m.trace.statusLog.length - 1]}</span>
                        </div>
                      )}
                    </div>
                  )}

                {/* Message Body */}
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-100">
                  {m.content || (loading ? "Synthesizing response..." : "")}
                </div>

                {/* Extracted Web Sources */}
                {m.sources && m.sources.length > 0 && (
                  <div className="pt-3 mt-2 border-t border-zinc-800/60 flex flex-wrap gap-1.5">
                    {m.sources.slice(0, 8).map((src, idx) => (
                      <a
                        key={idx}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 transition"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate max-w-[180px]">{src.title}</span>
                        <ExternalLink className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Bottom Sticky Input Bar */}
      <footer className="sticky bottom-0 bg-zinc-950/90 backdrop-blur border-t border-zinc-800 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="max-w-4xl mx-auto flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything, or reference a past date ('What did I ask on 3 November?')..."
            className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm flex items-center gap-2 transition"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}