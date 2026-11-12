"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search,
  Database,
  Clock,
  RotateCcw,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ArrowUp,
  ArrowUpRight,
  Copy,
  RefreshCw,
  Globe,
  Loader2,
  ShieldCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Rows3,
  Link2,
} from "lucide-react";

import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ai-elements/prompt-input";
import {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
} from "@/components/ai-elements/chain-of-thought";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  MessageResponse,
  type CitationItem,
} from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

interface MemoryItemTrace {
  id: number;
  role: string;
  created_at: string;
  matchReason: string;
  preview: string;
}

interface SearchStepTrace {
  queries: string[];
  provider?: string;
  sources?: CitationItem[];
}

interface MemoryGateTrace {
  should_store: boolean;
  category: string;
  reason: string;
  storageAction?: "inserted" | "consolidated" | "skipped";
  consolidatedIntoId?: number;
  similarityScore?: number;
}

interface TelemetryTrace {
  memories?: MemoryItemTrace[];
  memoryTelemetry?: string[];
  searches?: SearchStepTrace[];
  memoryGate?: MemoryGateTrace;
  reasoningText?: string;
  statusLog: string[];
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: CitationItem[];
  trace?: TelemetryTrace;
}

interface SqliteMemoryRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources_json?: string;
}

interface MemoryTurnPair {
  pairId: string;
  userRow?: SqliteMemoryRow;
  assistantRow?: SqliteMemoryRow;
  createdAt: string;
}

const NIM_MODELS = [
  {
    id: "poolside/laguna-xs-2.1",
    name: "Laguna XS 2.1",
    tag: "AGENTIC CODING",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55bb",
    name: "Nemotron 3 Ultra 550B",
    tag: "FRONTIER REASONING",
  },
  {
    id: "stepfun-ai/step-5-preview",
    name: "Step 5 Preview",
    tag: "AGENTIC PREVIEW",
  },
  {
    id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    name: "Nemotron 3.5 Super VL 120B",
    tag: "VISION-LANGUAGE",
  },
];

const EVALUATION_PROMPTS = [
  {
    index: "01",
    tag: "CRM SHORTLIST DIFF",
    fullPrompt:
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
  },
  {
    index: "02",
    tag: "TEMPORAL VERIFICATION",
    fullPrompt:
      "What did I ask you on 3 November? Is your answer still correct today?",
  },
  {
    index: "03",
    tag: "INFRASTRUCTURE BASELINE",
    fullPrompt:
      "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
  },
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toLocalDatetimeInputValue(isoString: string): string {
  try {
    const d = new Date(isoString);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/**
 * Custom Theme-Matched Model Picker Dropdown (Replaces native browser <select>)
 */
function CustomModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = NIM_MODELS.find((m) => m.id === value) || NIM_MODELS[0];

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-tech text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-pill)] transition-colors duration-150 cursor-pointer"
      >
        <span>{selected.name}</span>
        <ChevronDown
          className={`size-3 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full left-0 mb-2 z-40 w-64 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl animate-reveal-up"
        >
          <div className="px-2.5 py-1.5 font-tech text-[10px] uppercase tracking-widest text-[var(--fg-muted)] border-b border-[var(--border-hairline)] mb-1">
            NVIDIA NIM MODEL POOL
          </div>
          {NIM_MODELS.map((m) => {
            const active = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors duration-150 cursor-pointer ${
                  active
                    ? "bg-[var(--bg-pill)] text-[var(--fg-primary)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--bg-pill)] hover:text-[var(--fg-primary)]"
                }`}
              >
                <div>
                  <div className="text-xs font-medium text-[var(--fg-primary)]">
                    {m.name}
                  </div>
                  <div className="font-tech text-[10px] text-[var(--fg-muted)]">
                    {m.tag}
                  </div>
                </div>
                {active && <Check className="size-3.5 text-[var(--fg-primary)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Custom Theme-Matched Calendar Date Picker Popover (Replaces native browser <input type="date">)
 */
function CustomDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initialDate = value ? new Date(value + "T12:00:00") : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectDay = (day: number) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const formatted = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    onChange(formatted);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative hidden sm:inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-3 py-1 font-tech text-[11px] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] transition-colors duration-150 cursor-pointer"
      >
        <Clock className="size-3" />
        <span>{value ? value : "DATE: LIVE"}</span>
        {value && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="ml-0.5 text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
          >
            <X className="size-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-64 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-popover)] p-3 shadow-2xl animate-reveal-up">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-hairline)]">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded-lg hover:bg-[var(--bg-pill)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] cursor-pointer"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="font-tech text-xs font-medium text-[var(--fg-primary)]">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded-lg hover:bg-[var(--bg-pill)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] cursor-pointer"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center font-tech text-[10px] text-[var(--fg-muted)] mb-1">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center font-tech text-xs">
            {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
              <span key={`empty-${idx}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const pad = (n: number) => String(n).padStart(2, "0");
              const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
              const isSelected = value === iso;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`py-1 rounded-lg transition-colors duration-150 cursor-pointer ${
                    isSelected
                      ? "bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-semibold"
                      : "text-[var(--fg-secondary)] hover:bg-[var(--bg-pill)] hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 pt-2 border-t border-[var(--border-hairline)] flex items-center justify-between font-tech text-[10px]">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="text-[var(--fg-muted)] hover:text-[var(--fg-primary)] cursor-pointer"
            >
              Reset to Live
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().split("T")[0];
                onChange(today);
                setOpen(false);
              }}
              className="text-[var(--fg-primary)] hover:underline cursor-pointer"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatAgentPage() {
  // Persisted Theme State initialized lazily (0 setState calls inside useEffect!)
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("minimi-theme");
      if (saved === "light" || saved === "dark") return saved;
    }
    return "dark";
  });

  // Opposite polarity for the intro curtain, locked at initial mount
  const [introThemePolarity] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("minimi-theme");
      if (saved === "light") return "dark";
    }
    return "light";
  });

  // Cinematic Product-Film Intro Stage:
  // 0 = initial mount
  // 1 = "TEMPORAL EPISODIC MEMORY + PARALLEL WEB SEARCH" (in)
  // 2 = fade up + blur out
  // 3 = "Always better, never fail" (in)
  // 4 = fade up + blur out
  // 5 = "minimi" (in)
  // 6 = "minimi" fade up + blur out
  // 7 = raise curtain with soft ease & unblur page underneath
  // 8 = intro unmounted
  const [introStage, setIntroStage] = useState<number>(1);

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [memoryRows, setMemoryRows] = useState<SqliteMemoryRow[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(NIM_MODELS[0].id);
  const [useWebSearch, setUseWebSearch] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [backdateInput, setBackdateInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // SQLite Memory Modal
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryViewMode, setMemoryViewMode] = useState<"pairs" | "cards">(
    "pairs"
  );
  const [hoveredPairId, setHoveredPairId] = useState<string | null>(null);
  const [expandedCompactPairs, setExpandedCompactPairs] = useState<
    Record<string, boolean>
  >({});
  const [memBusy, setMemBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<"user" | "assistant">("user");
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [newRole, setNewRole] = useState<"user" | "assistant">("user");
  const [newContent, setNewContent] = useState("");
  const [newDate, setNewDate] = useState(() =>
    toLocalDatetimeInputValue(new Date().toISOString())
  );

  const turnCounterRef = useRef(1);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const introTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Sync theme attribute to <html> without calling setState inside useEffect
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Choreographed Product-Video Intro Sequence
  useEffect(() => {
    introTimersRef.current = [
      setTimeout(() => setIntroStage(2), 950), // Blur-up phrase 1
      setTimeout(() => setIntroStage(3), 1350), // Reveal "Always better, never fail"
      setTimeout(() => setIntroStage(4), 2300), // Blur-up phrase 2
      setTimeout(() => setIntroStage(5), 2700), // Reveal "minimi"
      setTimeout(() => setIntroStage(6), 3550), // Blur-up "minimi"
      setTimeout(() => setIntroStage(7), 3900), // Lift curtain + unblur main page
      setTimeout(() => setIntroStage(8), 5050), // Unmount after curtain lift completes
    ];
    return () => introTimersRef.current.forEach(clearTimeout);
  }, []);

  // Clicking anywhere during the intro blurs the current text and smoothly raises the curtain
  const handleSkipIntro = useCallback(() => {
    if (introStage >= 7) return;
    introTimersRef.current.forEach(clearTimeout);
    setIntroStage(7); // Triggers the -translate-y-full curtain lift & main page unblur
    const unmountTimer = setTimeout(() => setIntroStage(8), 1150);
    introTimersRef.current = [unmountTimer];
  }, [introStage]);

  const refreshSqliteMemory = useCallback(async () => {
    const res = await fetch("/api/memory");
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) {
      setMemoryRows(data.messages);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const res = await fetch("/api/memory");
      const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
      if (active && data.messages) {
        setMemoryRows(data.messages);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  /**
   * Groups top-to-bottom SQLite rows into linked (User Prompt -> Assistant Response) pairs
   * so hovering either highlights both and shows their exact relationship.
   */
  const linkedMemoryPairs = useMemo<MemoryTurnPair[]>(() => {
    const pairs: MemoryTurnPair[] = [];
    let i = 0;
    while (i < memoryRows.length) {
      const current = memoryRows[i];
      const next = memoryRows[i + 1];
      if (
        current.role === "user" &&
        next &&
        next.role === "assistant" &&
        next.session_id === current.session_id
      ) {
        pairs.push({
          pairId: `pair-${current.id}-${next.id}`,
          userRow: current,
          assistantRow: next,
          createdAt: current.created_at,
        });
        i += 2;
      } else {
        pairs.push({
          pairId: `single-${current.id}`,
          userRow: current.role === "user" ? current : undefined,
          assistantRow: current.role === "assistant" ? current : undefined,
          createdAt: current.created_at,
        });
        i += 1;
      }
    }
    return pairs;
  }, [memoryRows]);

  async function handleReseedMemory() {
    setMemBusy(true);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reseed" }),
    });
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) setMemoryRows(data.messages);
    setMemBusy(false);
  }

  async function handleClearAllMemory() {
    setMemBusy(true);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) setMemoryRows(data.messages);
    setMemBusy(false);
  }

  async function handleAddMemory(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    setMemBusy(true);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        role: newRole,
        content: newContent,
        createdAt: newDate ? new Date(newDate).toISOString() : undefined,
      }),
    });
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) setMemoryRows(data.messages);
    setNewContent("");
    setShowAddForm(false);
    setMemBusy(false);
  }

  function startEditRow(row: SqliteMemoryRow) {
    setEditingId(row.id);
    setEditRole(row.role);
    setEditContent(row.content);
    setEditDate(toLocalDatetimeInputValue(row.created_at));
  }

  async function handleSaveEdit(id: number) {
    if (!editContent.trim()) return;
    setMemBusy(true);
    const res = await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        role: editRole,
        content: editContent,
        createdAt: editDate ? new Date(editDate).toISOString() : undefined,
      }),
    });
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) setMemoryRows(data.messages);
    setEditingId(null);
    setMemBusy(false);
  }

  async function handleDeleteRow(id: number) {
    setMemBusy(true);
    const res = await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
    const data = (await res.json()) as { messages?: SqliteMemoryRow[] };
    if (data.messages) setMemoryRows(data.messages);
    setMemBusy(false);
  }

  function handleCopyMessage(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1800);
  }

  async function executeAgentTurn(
    promptText: string,
    replaceAssistantId?: string
  ) {
    const text = promptText.trim();
    if (!text || loading) return;

    if (!replaceAssistantId) {
      setInput("");
    }
    setLoading(true);

    const seq = turnCounterRef.current++;
    const timestampIso = backdateInput
      ? new Date(backdateInput + "T12:00:00").toISOString()
      : new Date().toISOString();

    const assistantId = replaceAssistantId || `assistant-turn-${seq}`;
    const initialTrace: TelemetryTrace = {
      memories: [],
      memoryTelemetry: [],
      searches: [],
      reasoningText: "",
      statusLog: [],
    };

    if (replaceAssistantId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === replaceAssistantId
            ? {
                ...m,
                content: "",
                sources: [],
                trace: initialTrace,
              }
            : m
        )
      );
    } else {
      const userTurn: ChatTurn = {
        id: `user-turn-${seq}`,
        role: "user",
        content: text,
        created_at: timestampIso,
      };
      setMessages((prev) => [
        ...prev,
        userTurn,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          created_at: timestampIso,
          trace: initialTrace,
        },
      ]);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: selectedModel,
          webSearch: useWebSearch,
          customTimestamp: backdateInput
            ? new Date(backdateInput + "T12:00:00").toISOString()
            : undefined,
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
                memoryGate: m.trace?.memoryGate,
                reasoningText: m.trace?.reasoningText || "",
                statusLog: [...(m.trace?.statusLog || [])],
              };

              if (event.type === "status") {
                trace.statusLog.push(event.detail);
              } else if (event.type === "memory") {
                trace.memories = event.items;
                trace.memoryTelemetry = event.telemetry;
              } else if (event.type === "reasoning") {
                trace.reasoningText = event.text;
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
              } else if (event.type === "memory_gate") {
                trace.memoryGate = event.gate;
              } else if (event.type === "answer") {
                if (event.reasoning) trace.reasoningText = event.reasoning;
                return {
                  ...m,
                  content: event.content,
                  sources: event.sources,
                  trace,
                };
              } else if (event.type === "error") {
                return {
                  ...m,
                  content: `Error: ${event.message}`,
                  trace,
                };
              }

              return { ...m, trace };
            })
          );
        }
      }
      await refreshSqliteMemory();
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const isConversationActive = messages.length > 0;

  const renderPromptBox = () => (
    <PromptInput
      value={input}
      onValueChange={setInput}
      isLoading={loading}
      onSubmit={() => executeAgentTurn(input)}
      className="w-full"
    >
      <PromptInputTextarea
        placeholder={
          isConversationActive
            ? "Follow up or verify another date..."
            : "Ask a question, compare live pricing, or verify a past conversation..."
        }
      />
      <div className="mt-3 flex items-center justify-between pt-2 border-t border-[var(--border-hairline)]">
        <PromptInputActions>
          <PromptInputAction tooltip="Live parallel web_search tool">
            <button
              type="button"
              onClick={() => setUseWebSearch(!useWebSearch)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-tech uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
                useWebSearch
                  ? "bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium"
                  : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              }`}
            >
              <Globe className="size-3" />
              <span>Web Search</span>
            </button>
          </PromptInputAction>

          {/* Theme-Native Custom Model Picker */}
          <CustomModelPicker
            value={selectedModel}
            onChange={(id) => setSelectedModel(id)}
          />
        </PromptInputActions>

        <button
          type="button"
          disabled={!input.trim() || loading}
          onClick={() => executeAgentTurn(input)}
          aria-label="Send message"
          className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--fg-primary)] text-[var(--bg-canvas)] transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-20 cursor-pointer"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowUp className="size-4 stroke-[2.2]" />
          )}
        </button>
      </div>
    </PromptInput>
  );

  // Opposite-polarity palette for the cinematic intro curtain
  const introIsLight = introThemePolarity === "light";

  return (
    <div className="relative min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--fg-primary)]">
      {/* CINEMATIC PRODUCT-FILM INTRO CURTAIN (Opposite Theme Polarity + Fine Grain + Blur-Up Sequence) */}
      {introStage < 8 && (
        <div
          onClick={handleSkipIntro}
          className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-transform duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            introIsLight
              ? "bg-[#F4F1EA] text-[#141413]"
              : "bg-[#111110] text-[#F4F1EA]"
          } ${
            introStage >= 7
              ? "-translate-y-full pointer-events-none"
              : "translate-y-0"
          }`}
        >
          {/* Subtle Tactile Film Noise Grain + Frosted Atmospheric Layer (Intro Only) */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.055]"
             aria-hidden="true"
          >
            <filter id="minimi-intro-grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.82"
                numOctaves="3"
                stitchTiles="stitch"
              />
            </filter>
            <rect width="100%" height="100%" filter="url(#minimi-intro-grain)" />
          </svg>
          <div className="pointer-events-none absolute inset-0 backdrop-blur-[1.5px]" />

          {/* Stage 1 & 2: "TEMPORAL EPISODIC MEMORY + PARALLEL WEB SEARCH" */}
          <div
            className={`absolute max-w-3xl px-6 text-center font-editorial text-3xl sm:text-5xl md:text-6xl leading-[1.12] tracking-tight transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              introStage === 1
                ? "opacity-100 translate-y-0 blur-none"
                : introStage === 2
                ? "opacity-0 -translate-y-4 blur-md"
                : "opacity-0 translate-y-3 blur-sm pointer-events-none"
            }`}
          >
            Temporal Episodic Memory + Parallel Web Search
          </div>

          {/* Stage 3 & 4: "Always better, never fail" */}
          <div
            className={`absolute px-6 text-center font-editorial italic text-3xl sm:text-5xl tracking-tight transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              introStage === 3
                ? "opacity-100 translate-y-0 blur-none"
                : introStage === 4
                ? "opacity-0 -translate-y-4 blur-md"
                : "opacity-0 translate-y-3 blur-sm pointer-events-none"
            }`}
          >
            Always better, never fail
          </div>

          {/* Stage 5 & 6: "minimi" */}
          <div
            className={`absolute px-6 text-center font-editorial text-6xl sm:text-7xl tracking-tight transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              introStage === 5
                ? "opacity-100 translate-y-0 blur-none"
                : introStage >= 6
                ? "opacity-0 -translate-y-5 blur-md"
                : "opacity-0 translate-y-3 blur-sm pointer-events-none"
            }`}
          >
            minimi
          </div>
        </div>
      )}

      {/* MAIN PAGE WRAPPER (Unblurs smoothly as the curtain rises) */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-[filter,transform] duration-[1050ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          introStage < 7 ? "blur-md scale-[0.99]" : "blur-none scale-100"
        }`}
      >
        {/* Minimal Top Bar (h-14, no fake logo, no CTX-ACCUMULATED clutter) */}
        <header className="sticky top-0 z-20 h-14 px-5 md:px-8 flex items-center justify-between bg-[var(--bg-canvas)]/85 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="font-editorial text-2xl tracking-tight leading-none text-[var(--fg-primary)] hover:opacity-80 cursor-pointer"
          >
            minimi
          </button>

          <div className="flex items-center gap-2 md:gap-2.5 font-tech text-[11px]">
            {/* Custom Theme-Native Calendar Date Picker */}
            <CustomDatePicker
              value={backdateInput}
              onChange={(val) => setBackdateInput(val)}
            />

            {/* SQLite Episodic Memory Trigger */}
            <button
              type="button"
              onClick={() => setShowMemoryModal(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-3 py-1 text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] cursor-pointer"
            >
              <Database className="size-3" />
              <span>MEMORY [{String(memoryRows.length).padStart(2, "0")}]</span>
            </button>

            {/* Smooth View-Transition Theme Toggler */}
            <AnimatedThemeToggler
              theme={theme}
              onThemeChange={(next) => setTheme(next)}
              variant="circle"
              duration={900}
            />

            {isConversationActive && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-3 py-1 text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] cursor-pointer"
              >
                <RotateCcw className="size-3" />
                <span className="hidden sm:inline">RESET</span>
              </button>
            )}
          </div>
        </header>

        {/* EMPTY STATE: Pure Canvas + Editorial Greeting + Centered Prompt Bar */}
        {!isConversationActive ? (
          <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
            <div className="w-full max-w-[720px] space-y-8 animate-reveal-up">
              <div className="text-center">
                <h1 className="font-editorial text-4xl sm:text-5xl md:text-[54px] font-normal tracking-tight leading-[1.08] text-[var(--fg-primary)]">
                  What should we <span className="italic">verify</span> today?
                </h1>
              </div>

              {renderPromptBox()}

              <div className="pt-2">
                <div className="flex items-center justify-between font-tech text-[10px] uppercase tracking-widest text-[var(--fg-muted)] pb-2.5 border-b border-[var(--border-hairline)]">
                  <span>EVALUATION DATASET BENCHMARKS</span>
                  <span>01 — 03</span>
                </div>
                <div className="divide-y divide-[var(--border-hairline)] border-b border-[var(--border-hairline)]">
                  {EVALUATION_PROMPTS.map((item) => (
                    <button
                      key={item.index}
                      type="button"
                      onClick={() => executeAgentTurn(item.fullPrompt)}
                      className="group w-full py-3.5 px-2 flex items-center justify-between text-left transition-colors duration-150 hover:bg-[var(--bg-pill)] cursor-pointer"
                    >
                      <div className="flex items-baseline gap-4 min-w-0 pr-4">
                        <span className="font-tech text-xs text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)] transition-colors shrink-0">
                          {item.index}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[14px] text-[var(--fg-primary)] group-hover:translate-x-1 transition-transform duration-200 truncate">
                            {item.fullPrompt}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="hidden md:inline-block font-tech text-[10px] tracking-wider uppercase text-[var(--fg-muted)]">
                          {item.tag}
                        </span>
                        <ArrowUpRight className="size-4 text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-150" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </main>
        ) : (
          /* ACTIVE THREAD STATE */
          <>
            <main className="flex-1 w-full max-w-[720px] mx-auto px-4 pt-8 pb-12 space-y-10">
              {messages.map((m, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreamingThis = loading && isLastMessage && !m.content;

                if (m.role === "user") {
                  return (
                    <div
                      key={m.id}
                      className="flex justify-end animate-reveal-up"
                    >
                      <div className="bg-[var(--bg-pill)] border border-[var(--border-hairline)] text-[var(--fg-primary)] rounded-2xl px-4 py-2.5 max-w-[80%] text-[15px] leading-6">
                        {m.content}
                      </div>
                    </div>
                  );
                }

                const hasAgenticSteps =
                  (m.trace?.memories && m.trace.memories.length > 0) ||
                  (m.trace?.searches && m.trace.searches.length > 0) ||
                  Boolean(m.trace?.memoryGate) ||
                  (isStreamingThis && (m.trace?.statusLog.length || 0) > 0);

                return (
                  <div key={m.id} className="space-y-4 animate-reveal-up">
                    {/* 1. AGENTIC STEPS (ChainOfThought — Expanded by default) */}
                    {hasAgenticSteps && m.trace && (
                      <ChainOfThought className="mb-3">
                        {m.trace.memories && m.trace.memories.length > 0 && (
                          <ChainOfThoughtStep defaultOpen={true}>
                            <ChainOfThoughtTrigger
                              leftIcon={<Database className="size-3.5" />}
                            >
                              Recalled {m.trace.memories.length} episodic memory
                              record(s)
                            </ChainOfThoughtTrigger>
                            <ChainOfThoughtContent>
                              {m.trace.memoryTelemetry?.map((t, i) => (
                                <ChainOfThoughtItem key={i}>
                                  {t}
                                </ChainOfThoughtItem>
                              ))}
                            </ChainOfThoughtContent>
                          </ChainOfThoughtStep>
                        )}

                        {m.trace.searches?.map((s, sIdx) => (
                          <ChainOfThoughtStep key={sIdx} defaultOpen={true}>
                            <ChainOfThoughtTrigger
                              leftIcon={<Search className="size-3.5" />}
                            >
                              Web search: {s.queries.join(" · ")}
                              {s.sources
                                ? ` (${s.sources.length} results)`
                                : ""}
                            </ChainOfThoughtTrigger>
                            <ChainOfThoughtContent>
                              {s.queries.map((q, qIdx) => (
                                <ChainOfThoughtItem key={qIdx}>
                                  Query: {q}
                                </ChainOfThoughtItem>
                              ))}
                              {s.sources && s.sources.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {s.sources.slice(0, 6).map((src, srcIdx) => {
                                    let domain = src.url;
                                    try {
                                      domain = new URL(
                                        src.url
                                      ).hostname.replace(/^www\./, "");
                                    } catch {
                                      domain = src.title;
                                    }
                                    return (
                                      <a
                                        key={srcIdx}
                                        href={src.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-0.5 font-tech text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:border-[var(--border-strong)] transition-colors duration-150"
                                      >
                                        <span>[{src.number}]</span>
                                        <span className="truncate max-w-[140px]">
                                          {domain}
                                        </span>
                                      </a>
                                    );
                                  })}
                                </div>
                              )}
                            </ChainOfThoughtContent>
                          </ChainOfThoughtStep>
                        ))}

                        {m.trace.memoryGate && (
                          <ChainOfThoughtStep defaultOpen={false}>
                            <ChainOfThoughtTrigger
                              leftIcon={<ShieldCheck className="size-3.5" />}
                            >
                              {m.trace.memoryGate.storageAction ===
                              "consolidated"
                                ? `Memory consolidated into record #${m.trace.memoryGate.consolidatedIntoId} (${m.trace.memoryGate.similarityScore}% match)`
                                : m.trace.memoryGate.should_store
                                ? `Saved to episodic memory (#${m.trace.memoryGate.consolidatedIntoId})`
                                : "Ephemeral turn skipped by memory gate"}
                            </ChainOfThoughtTrigger>
                            <ChainOfThoughtContent>
                              <ChainOfThoughtItem>
                                {m.trace.memoryGate.reason}
                              </ChainOfThoughtItem>
                            </ChainOfThoughtContent>
                          </ChainOfThoughtStep>
                        )}
                      </ChainOfThought>
                    )}

                    {/* 2. THINKING (Reasoning with TextShimmer & hidden-scrollbar scroll area) */}
                    {(m.trace?.reasoningText || isStreamingThis) && (
                      <Reasoning isStreaming={isStreamingThis} className="mb-3">
                        <ReasoningTrigger>
                          {isStreamingThis ? (
                            <TextShimmer duration={2.2} spread={24}>
                              Thinking...
                            </TextShimmer>
                          ) : (
                            "Show reasoning"
                          )}
                        </ReasoningTrigger>
                        <ReasoningContent markdown>
                          {m.trace?.reasoningText ||
                            m.trace?.statusLog.join("\n") ||
                            "Evaluating temporal context and search parameters..."}
                        </ReasoningContent>
                      </Reasoning>
                    )}

                    {/* 3. UNBOXED AI RESPONSE DIRECTLY ON CANVAS */}
                    {m.content ? (
                      <MessageResponse citations={m.sources}>
                        {m.content}
                      </MessageResponse>
                    ) : isStreamingThis ? (
                      <div className="font-tech text-[12px] text-[var(--fg-secondary)] flex items-center gap-2 py-1">
                        <Loader2 className="size-3.5 animate-spin" />
                        <TextShimmer duration={2.5} spread={20}>
                          {m.trace?.statusLog.at(-1) ||
                            "Synthesizing response..."}
                        </TextShimmer>
                      </div>
                    ) : null}

                    {/* 4. SUBTLE MESSAGE ACTION BAR */}
                    {m.content && (
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.id, m.content)}
                          className="inline-flex items-center gap-1.5 font-tech text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors duration-150 cursor-pointer"
                          title="Copy response"
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="size-3.5 text-[var(--fg-primary)]" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            const prevUser = messages[index - 1];
                            if (prevUser?.role === "user") {
                              executeAgentTurn(prevUser.content, m.id);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 font-tech text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
                          title="Retry response"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </main>

            {/* Clean Bottom Pinned Prompt Input */}
            <footer className="sticky bottom-0 z-20 bg-[var(--bg-canvas)]/90 backdrop-blur-md pt-2 pb-6 px-4">
              <div className="max-w-[720px] mx-auto">{renderPromptBox()}</div>
            </footer>
          </>
        )}
      </div>

      {/* TOP-TO-BOTTOM LINKED EPISODIC MEMORY MODAL (With Markdown + Hover Pair Highlight + View Switcher) */}
      {showMemoryModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-editorial text-xl text-[var(--fg-primary)]">
                  Episodic Memory Ledger ({linkedMemoryPairs.length} linked
                  exchanges · {memoryRows.length} rows)
                </h2>
                <p className="font-tech text-[11px] text-[var(--fg-secondary)] mt-0.5">
                  Chronological top-to-bottom order · Hover any prompt or reply
                  to highlight its linked counterpart
                </p>
              </div>

              <div className="flex items-center gap-2 font-tech text-[11px]">
                {/* View Mode Toggle: Compact Pairs vs Full Expanded Cards */}
                <div className="inline-flex items-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setMemoryViewMode("pairs")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition-colors cursor-pointer ${
                      memoryViewMode === "pairs"
                        ? "bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium"
                        : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                    }`}
                  >
                    <Rows3 className="size-3" />
                    <span>COMPACT PAIRS</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryViewMode("cards")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition-colors cursor-pointer ${
                      memoryViewMode === "cards"
                        ? "bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium"
                        : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                    }`}
                  >
                    <LayoutList className="size-3" />
                    <span>FULL CARDS</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="px-3 py-1.5 rounded-full bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  ADD
                </button>
                <button
                  type="button"
                  onClick={handleReseedMemory}
                  disabled={memBusy}
                  className="px-3 py-1.5 rounded-full border border-[var(--border-hairline)] text-[var(--fg-primary)] hover:border-[var(--border-strong)] cursor-pointer"
                >
                  RESEED
                </button>
                <button
                  type="button"
                  onClick={handleClearAllMemory}
                  disabled={memBusy}
                  className="px-3 py-1.5 rounded-full border border-[var(--border-hairline)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] cursor-pointer"
                >
                  WIPE
                </button>
                <button
                  type="button"
                  onClick={() => setShowMemoryModal(false)}
                  className="p-1.5 text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {showAddForm && (
              <form
                onSubmit={handleAddMemory}
                className="p-4 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3"
              >
                <div className="flex gap-3">
                  <select
                    value={newRole}
                    onChange={(e) =>
                      setNewRole(e.target.value as "user" | "assistant")
                    }
                    className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-tech text-xs text-[var(--fg-primary)]"
                  >
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                  </select>
                  <input
                    type="datetime-local"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-tech text-xs text-[var(--fg-primary)]"
                  />
                </div>
                <textarea
                  rows={3}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Memory content (Markdown supported)..."
                  className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2.5 text-xs text-[var(--fg-primary)] focus:outline-none"
                />
                <div className="flex justify-end gap-2 font-tech text-xs">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1 text-[var(--fg-secondary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={memBusy}
                    className="px-3 py-1 rounded-full bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {/* Memory List Container (Top-to-Bottom Chronological Order) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {linkedMemoryPairs.map((pair, pairIdx) => {
                const isPairHovered = hoveredPairId === pair.pairId;
                const isCompactExpanded =
                  expandedCompactPairs[pair.pairId] ?? false;
                const dateLabel = new Date(pair.createdAt)
                  .toISOString()
                  .split("T")[0];

                // VIEW MODE 1: COMPACT COLLAPSIBLE PAIRS (User Query + Model Response together)
                if (memoryViewMode === "pairs") {
                  return (
                    <div
                      key={pair.pairId}
                      onMouseEnter={() => setHoveredPairId(pair.pairId)}
                      onMouseLeave={() => setHoveredPairId(null)}
                      className={`rounded-xl border transition-colors duration-150 overflow-hidden bg-[var(--bg-canvas)] ${
                        isPairHovered
                          ? "border-[var(--fg-primary)]"
                          : "border-[var(--border-hairline)]"
                      }`}
                    >
                      {/* Compact Pair Summary Row */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCompactPairs((prev) => ({
                            ...prev,
                            [pair.pairId]: !isCompactExpanded,
                          }))
                        }
                        className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left cursor-pointer hover:bg-[var(--bg-pill)] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="font-tech text-[11px] text-[var(--fg-muted)] shrink-0">
                            {String(pairIdx + 1).padStart(2, "0")}
                          </span>
                          <span className="font-tech text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-hairline)] text-[var(--fg-secondary)] shrink-0">
                            {dateLabel}
                          </span>
                          <span className="text-xs font-medium text-[var(--fg-primary)] truncate">
                            {pair.userRow?.content ||
                              pair.assistantRow?.content}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 font-tech text-[10px] text-[var(--fg-muted)]">
                          {pair.userRow && pair.assistantRow && (
                            <span className="inline-flex items-center gap-1">
                              <Link2 className="size-3" />
                              <span>
                                #{pair.userRow.id} → #{pair.assistantRow.id}
                              </span>
                            </span>
                          )}
                          <ChevronDown
                            className={`size-3.5 transition-transform duration-150 ${
                              isCompactExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </button>

                      {/* Expanded Pair Details with Markdown */}
                      {isCompactExpanded && (
                        <div className="border-t border-[var(--border-hairline)] p-4 space-y-4">
                          {[pair.userRow, pair.assistantRow]
                            .filter((r): r is SqliteMemoryRow => Boolean(r))
                            .map((row) => (
                              <div
                                key={row.id}
                                className="space-y-1.5 border-l-2 border-[var(--border-strong)] pl-3.5"
                              >
                                <div className="flex items-center justify-between font-tech text-[10px] text-[var(--fg-secondary)]">
                                  <div className="flex items-center gap-2">
                                    <span>
                                      #{String(row.id).padStart(2, "0")}
                                    </span>
                                    <span className="uppercase font-semibold text-[var(--fg-primary)]">
                                      {row.role}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMemoryViewMode("cards");
                                        startEditRow(row);
                                      }}
                                      className="p-1 hover:text-[var(--fg-primary)] cursor-pointer"
                                    >
                                      <Pencil className="size-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRow(row.id)}
                                      className="p-1 hover:text-[var(--fg-primary)] cursor-pointer"
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs">
                                  <MessageResponse>
                                    {row.content}
                                  </MessageResponse>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                }

                // VIEW MODE 2: FULL LINKED CARDS (Hovering either User or AI card highlights both!)
                return (
                  <div
                    key={pair.pairId}
                    onMouseEnter={() => setHoveredPairId(pair.pairId)}
                    onMouseLeave={() => setHoveredPairId(null)}
                    className="relative pl-4 space-y-2"
                  >
                    {/* Left Vertical Connector Line that lights up when hovering either linked card */}
                    <div
                      className={`absolute left-1 top-3 bottom-3 w-[2px] rounded-full transition-colors duration-150 ${
                        isPairHovered
                          ? "bg-[var(--fg-primary)]"
                          : "bg-[var(--border-hairline)]"
                      }`}
                    />

                    {[pair.userRow, pair.assistantRow]
                      .filter((r): r is SqliteMemoryRow => Boolean(r))
                      .map((row) => {
                        const isEditing = editingId === row.id;
                        return (
                          <div
                            key={row.id}
                            className={`rounded-xl border bg-[var(--bg-canvas)] p-3.5 space-y-2 transition-colors duration-150 ${
                              isPairHovered
                                ? "border-[var(--fg-primary)]"
                                : "border-[var(--border-hairline)]"
                            }`}
                          >
                            {isEditing ? (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                  <select
                                    value={editRole}
                                    onChange={(e) =>
                                      setEditRole(
                                        e.target.value as "user" | "assistant"
                                      )
                                    }
                                    className="rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1 font-tech text-xs text-[var(--fg-primary)]"
                                  >
                                    <option value="user">user</option>
                                    <option value="assistant">assistant</option>
                                  </select>
                                  <input
                                    type="datetime-local"
                                    value={editDate}
                                    onChange={(e) =>
                                      setEditDate(e.target.value)
                                    }
                                    className="rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 py-1 font-tech text-xs text-[var(--fg-primary)]"
                                  />
                                </div>
                                <textarea
                                  rows={3}
                                  value={editContent}
                                  onChange={(e) =>
                                    setEditContent(e.target.value)
                                  }
                                  className="w-full rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--fg-primary)]"
                                />
                                <div className="flex justify-end gap-2 font-tech text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="text-[var(--fg-secondary)]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(row.id)}
                                    className="px-2.5 py-1 rounded bg-[var(--fg-primary)] text-[var(--bg-canvas)] font-medium"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between font-tech text-[11px] text-[var(--fg-secondary)]">
                                  <div className="flex items-center gap-2">
                                    <span>
                                      #{String(row.id).padStart(2, "0")}
                                    </span>
                                    <span className="uppercase font-medium text-[var(--fg-primary)]">
                                      {row.role}
                                    </span>
                                    <span>
                                      {
                                        new Date(row.created_at)
                                          .toISOString()
                                          .split("T")[0]
                                      }
                                    </span>
                                    {pair.userRow && pair.assistantRow && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--fg-muted)]">
                                        <Link2 className="size-3" />
                                        <span>
                                          Linked #{pair.userRow.id}↔#
                                          {pair.assistantRow.id}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => startEditRow(row)}
                                      className="p-1 hover:text-[var(--fg-primary)] cursor-pointer"
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRow(row.id)}
                                      className="p-1 hover:text-[var(--fg-primary)] cursor-pointer"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs">
                                  <MessageResponse>
                                    {row.content}
                                  </MessageResponse>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}