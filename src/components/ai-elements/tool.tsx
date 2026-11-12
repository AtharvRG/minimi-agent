"use client";

import React, { useState, createContext, useContext } from "react";
import {
  WrenchIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
} from "lucide-react";

export type ToolExecutionState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

const ToolContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function getStatusBadge(state: ToolExecutionState) {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
          <Loader2Icon className="size-3 animate-spin" />
          Running
        </span>
      );
    case "output-available":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          <CheckCircle2Icon className="size-3" />
          Completed
        </span>
      );
    case "output-error":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-[10px] font-medium text-red-300">
          <AlertCircleIcon className="size-3" />
          Error
        </span>
      );
  }
}

export function Tool({
  defaultOpen = false,
  children,
  className = "",
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <ToolContext.Provider value={{ open, setOpen }}>
      <div
        className={`rounded-xl border border-zinc-800/90 bg-zinc-950/80 overflow-hidden ${className}`}
      >
        {children}
      </div>
    </ToolContext.Provider>
  );
}

export function ToolHeader({
  title,
  type,
  state,
}: {
  title?: string;
  type: string;
  state: ToolExecutionState;
}) {
  const { open, setOpen } = useContext(ToolContext);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="flex w-full items-center justify-between px-3.5 py-2 text-xs hover:bg-zinc-900/60 transition cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-3.5 text-sky-400" />
        <span className="font-mono font-medium text-zinc-200">
          {title || type}
        </span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon
        className={`size-3.5 text-zinc-500 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

export function ToolContent({ children }: { children: React.ReactNode }) {
  const { open } = useContext(ToolContext);
  if (!open) return null;
  return (
    <div className="border-t border-zinc-900 p-3 space-y-2.5 text-xs">
      {children}
    </div>
  );
}

export function ToolInput({ input }: { input: unknown }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
        Tool Input Parameters
      </div>
      <pre className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-2.5 font-mono text-[11px] text-zinc-300 overflow-x-auto">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

export function ToolOutput({
  output,
  errorText,
}: {
  output?: React.ReactNode;
  errorText?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
        Tool Output
      </div>
      {errorText ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          {errorText}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 text-xs text-zinc-300">
          {output}
        </div>
      )}
    </div>
  );
}