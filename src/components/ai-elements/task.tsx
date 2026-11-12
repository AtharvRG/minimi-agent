"use client";

import React, { useState, createContext, useContext } from "react";
import { CheckSquareIcon, ChevronDownIcon } from "lucide-react";

const TaskContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: true,
  setOpen: () => {},
});

export function Task({
  defaultOpen = true,
  children,
  className = "",
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <TaskContext.Provider value={{ open, setOpen }}>
      <div
        className={`rounded-xl border border-zinc-800/80 bg-zinc-950/70 overflow-hidden ${className}`}
      >
        {children}
      </div>
    </TaskContext.Provider>
  );
}

export function TaskTrigger({ title }: { title: string }) {
  const { open, setOpen } = useContext(TaskContext);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900/60 transition cursor-pointer"
    >
      <span className="flex items-center gap-2">
        <CheckSquareIcon className="size-3.5 text-emerald-400" />
        <span>{title}</span>
      </span>
      <ChevronDownIcon
        className={`size-3.5 text-zinc-500 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

export function TaskContent({ children }: { children: React.ReactNode }) {
  const { open } = useContext(TaskContext);
  if (!open) return null;
  return (
    <div className="border-t border-zinc-900 px-3.5 py-2.5 space-y-1.5 text-xs text-zinc-300">
      {children}
    </div>
  );
}

export function TaskItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-300">
      <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function TaskItemFile({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 ml-1">
      {children}
    </span>
  );
}