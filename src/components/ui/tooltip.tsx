"use client";

import React, { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

const TooltipContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <span
        className="relative inline-flex items-center"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </span>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  onClick,
}: {
  asChild?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler;
}) {
  return <span onClick={onClick}>{children}</span>;
}

export function TooltipContent({
  children,
  side = "top",
  className,
}: {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const { open } = useContext(TooltipContext);
  if (!open || !children) return null;

  const pos =
    side === "bottom"
      ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
      : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";

  return (
    <span
      className={cn(
        "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-white/10 bg-[#1E1E20] px-2 py-1 text-[11px] text-[#ECECEC]",
        pos,
        className
      )}
    >
      {children}
    </span>
  );
}