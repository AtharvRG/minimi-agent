"use client";

import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ReasoningContextType = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const ReasoningContext = createContext<ReasoningContextType | undefined>(
  undefined
);

function useReasoningContext() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error(
      "useReasoningContext must be used within a Reasoning provider"
    );
  }
  return context;
}

export type ReasoningProps = {
  children: React.ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isStreaming?: boolean;
};

function Reasoning({
  children,
  className,
  open,
  onOpenChange,
  isStreaming = false,
}: ReasoningProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const isControlled = open !== undefined;
  const isOpen = isControlled
    ? open
    : manualOpen !== null
    ? manualOpen
    : Boolean(isStreaming);

  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setManualOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <ReasoningContext.Provider
      value={{
        isOpen,
        onOpenChange: handleOpenChange,
      }}
    >
      <div className={className}>{children}</div>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLButtonElement>;

function ReasoningTrigger({
  children,
  className,
  ...props
}: ReasoningTriggerProps) {
  const { isOpen, onOpenChange } = useReasoningContext();

  return (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] transition-colors duration-150",
        className
      )}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      <span>{children}</span>
      <div
        className={cn(
          "transform transition-transform duration-150",
          isOpen ? "rotate-180" : ""
        )}
      >
        <ChevronDownIcon className="size-3.5" />
      </div>
    </button>
  );
}

export type ReasoningContentProps = {
  children: React.ReactNode;
  className?: string;
  markdown?: boolean;
  contentClassName?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const MAX_REASONING_HEIGHT_PX = 240;

function ReasoningContent({
  children,
  className,
  contentClassName,
  markdown = false,
  ...props
}: ReasoningContentProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);
  const { isOpen } = useReasoningContext();

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const updateHeight = () => {
      // +8px safety buffer so descenders (g, p, y, brackets) are never clipped
      setMeasuredHeight(
        Math.min(el.scrollHeight + 8, MAX_REASONING_HEIGHT_PX)
      );
      // Keep latest streaming line in view
      el.scrollTop = el.scrollHeight;
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [children, isOpen]);

  const content = markdown ? (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {String(children || "")}
    </ReactMarkdown>
  ) : (
    children
  );

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden transition-[max-height] duration-150 ease-out",
        className
      )}
      style={{
        maxHeight: isOpen
          ? `${measuredHeight || MAX_REASONING_HEIGHT_PX}px`
          : "0px",
      }}
      {...props}
    >
      <div
        ref={innerRef}
        style={{ maxHeight: `${MAX_REASONING_HEIGHT_PX}px` }}
        className={cn(
          "overflow-y-auto no-scrollbar border-l border-[var(--border-strong)] pl-3.5 pr-2 py-1 text-[13px] leading-6 text-[var(--fg-secondary)] whitespace-pre-wrap",
          contentClassName
        )}
      >
        {content}
      </div>
    </div>
  );
}

export { Reasoning, ReasoningTrigger, ReasoningContent };