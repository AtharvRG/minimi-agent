"use client";

import React, { useState } from "react";
import { CpuIcon, ChevronDownIcon, TerminalIcon } from "lucide-react";

export function Agent({
  children,
  className = "",
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-zinc-900/90 overflow-hidden shadow-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function AgentHeader({
  name,
  model,
}: {
  name: string;
  model?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <CpuIcon className="size-4 text-emerald-400" />
        <span className="text-sm font-semibold text-zinc-100">{name}</span>
      </div>
      {model && (
        <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
          {model}
        </span>
      )}
    </div>
  );
}

export function AgentContent({
  children,
  className = "",
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 space-y-4 text-xs ${className}`}>{children}</div>;
}

export function AgentInstructions({ children }: { children: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        System Instructions & Architecture
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function AgentTools({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Configured Agent Tools (Single-Tool Constraint)
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function AgentTool({
  tool,
  value,
}: {
  tool: { description: string; inputSchema: Record<string, unknown> };
  value: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-900 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-3.5 text-sky-400" />
          <span className="font-mono font-semibold text-zinc-200">{value}</span>
          <span className="text-zinc-400 truncate max-w-md">
            — {tool.description}
          </span>
        </div>
        <ChevronDownIcon
          className={`size-3.5 text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <pre className="border-t border-zinc-900 p-3 font-mono text-[11px] text-zinc-300 overflow-x-auto">
          {JSON.stringify(tool.inputSchema, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AgentOutput({ schema }: { schema: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Memory Gate Output Schema
      </div>
      <pre className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto">
        {schema}
      </pre>
    </div>
  );
}