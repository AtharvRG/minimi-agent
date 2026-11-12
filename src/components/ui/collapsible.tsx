"use client";

import React, { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CollapsibleContext = createContext<CollapsibleContextValue>({
  open: false,
  onOpenChange: () => {},
});

export interface CollapsibleProps extends React.ComponentProps<"div"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = (next: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <CollapsibleContext.Provider
      value={{ open: isOpen, onOpenChange: handleOpenChange }}
    >
      <div
        data-state={isOpen ? "open" : "closed"}
        className={cn("group", className)}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger({
  children,
  className,
  onClick,
  ...props
}: React.ComponentProps<"button">) {
  const { open, onOpenChange } = useContext(CollapsibleContext);

  return (
    <button
      type="button"
      data-state={open ? "open" : "closed"}
      onClick={(e) => {
        onOpenChange(!open);
        onClick?.(e);
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

export function CollapsibleContent({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { open } = useContext(CollapsibleContext);
  if (!open) return null;

  return (
    <div
      data-state={open ? "open" : "closed"}
      className={cn(" transition-all duration-150 ease-out", className)}
      {...props}
    >
      {children}
    </div>
  );
}