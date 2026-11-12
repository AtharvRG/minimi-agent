"use client";

import React, {
  useState,
  createContext,
  useContext,
  useRef,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "lucide-react";

interface CitationCardContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  triggerRect: DOMRect | null;
  triggerRef: React.RefObject<HTMLSpanElement | null>;
}

const CitationCardContext = createContext<CitationCardContextValue>({
  open: false,
  setOpen: () => {},
  triggerRect: null,
  triggerRef: React.createRef<HTMLSpanElement>(),
});

const CarouselContext = createContext<{
  index: number;
  total: number;
  prev: () => void;
  next: () => void;
  setTotal: (n: number) => void;
}>({
  index: 0,
  total: 1,
  prev: () => {},
  next: () => {},
  setTotal: () => {},
});

export function InlineCitation({
  children,
  className = "",
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`relative inline-flex items-center align-baseline mx-0.5 ${className}`}
    >
      {children}
    </span>
  );
}

export function InlineCitationCard({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  const handleLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 120);
  };

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      if (triggerRef.current) {
        setTriggerRect(triggerRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <CitationCardContext.Provider
      value={{ open, setOpen, triggerRect, triggerRef }}
    >
      <span
        ref={triggerRef}
        className="relative inline-block"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </span>
    </CitationCardContext.Provider>
  );
}

export function InlineCitationCardTrigger({
  sources,
  label,
}: {
  sources: string[];
  label?: string;
}) {
  let hostname = "source";
  try {
    if (sources[0]) {
      hostname = new URL(sources[0]).hostname.replace(/^www\./, "");
    }
  } catch {
    hostname = "source";
  }

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full border border-[var(--border-hairline)] bg-[var(--bg-pill)] hover:border-[var(--border-strong)] hover:bg-[var(--fg-primary)] hover:text-[var(--bg-canvas)] px-1.5 font-tech text-[11px] font-medium text-[var(--fg-secondary)] transition-colors duration-150 cursor-pointer"
    >
      <span>{label || hostname}</span>
      {sources.length > 1 && (
        <span className="text-[10px] opacity-75 ml-0.5">
          +{sources.length - 1}
        </span>
      )}
    </button>
  );
}

export function InlineCitationCardBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const { open, setOpen, triggerRect } = useContext(CitationCardContext);

  if (!open || !triggerRect || typeof document === "undefined") return null;

  const CARD_WIDTH = 320;
  const CARD_ESTIMATED_HEIGHT = 210;
  const SCREEN_MARGIN = 14;
  const PILL_GAP = 12; // 12px clear gap so adjacent [1] [2] pills are never covered

  // Clamp horizontal position within viewport
  let left = triggerRect.left + triggerRect.width / 2 - CARD_WIDTH / 2;
  left = Math.max(
    SCREEN_MARGIN,
    Math.min(left, window.innerWidth - CARD_WIDTH - SCREEN_MARGIN)
  );

  // Default ABOVE the pill; only flip below if there isn't enough room near the top of the screen
  const placeAbove = triggerRect.top > CARD_ESTIMATED_HEIGHT + SCREEN_MARGIN;

  const anchorStyle: React.CSSProperties = placeAbove
    ? {
        position: "fixed",
        left: `${left}px`,
        bottom: `${window.innerHeight - triggerRect.top + PILL_GAP}px`,
        width: `${CARD_WIDTH}px`,
      }
    : {
        position: "fixed",
        left: `${left}px`,
        top: `${triggerRect.bottom + PILL_GAP}px`,
        width: `${CARD_WIDTH}px`,
      };

  return createPortal(
    <div
      style={anchorStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="z-[9999] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-popover)] p-3.5 text-[var(--fg-primary)] shadow-2xl text-left animate-reveal-up"
    >
      {children}
    </div>,
    document.body
  );
}

export function InlineCitationCarousel({
  children,
}: {
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(1);

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : total - 1));
  const next = () => setIndex((i) => (i < total - 1 ? i + 1 : 0));

  return (
    <CarouselContext.Provider value={{ index, total, prev, next, setTotal }}>
      <div className="space-y-2">{children}</div>
    </CarouselContext.Provider>
  );
}

export function InlineCitationCarouselHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-1.5 font-tech text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
      {children}
    </div>
  );
}

export function InlineCitationCarouselPrev() {
  const { prev, total } = useContext(CarouselContext);
  if (total <= 1) return null;
  return (
    <button
      type="button"
      onClick={prev}
      className="p-0.5 hover:text-[var(--fg-primary)] cursor-pointer"
    >
      <ChevronLeftIcon className="size-3.5" />
    </button>
  );
}

export function InlineCitationCarouselNext() {
  const { next, total } = useContext(CarouselContext);
  if (total <= 1) return null;
  return (
    <button
      type="button"
      onClick={next}
      className="p-0.5 hover:text-[var(--fg-primary)] cursor-pointer"
    >
      <ChevronRightIcon className="size-3.5" />
    </button>
  );
}

export function InlineCitationCarouselIndex() {
  const { index, total } = useContext(CarouselContext);
  return (
    <span className="font-tech text-[10px] text-[var(--fg-muted)]">
      SOURCE {index + 1}/{total}
    </span>
  );
}

export function InlineCitationCarouselContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  const { index } = useContext(CarouselContext);
  return <div>{items[index] || items[0]}</div>;
}

export function InlineCitationCarouselItem({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="space-y-2">{children}</div>;
}

export function InlineCitationSource({
  title,
  url,
  description,
}: {
  title: string;
  url: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-semibold text-[var(--fg-primary)] hover:underline flex items-center justify-between gap-1.5"
      >
        <span className="truncate">{title}</span>
        <ExternalLinkIcon className="size-3 shrink-0 text-[var(--fg-muted)]" />
      </a>
      <div className="text-[10px] font-tech text-[var(--fg-muted)] truncate">
        {url}
      </div>
      {description && (
        <p className="text-[11.5px] leading-relaxed text-[var(--fg-secondary)] line-clamp-2 pt-0.5">
          {description}
        </p>
      )}
    </div>
  );
}

export function InlineCitationQuote({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <blockquote className="border-l-2 border-[var(--border-strong)] pl-2.5 text-[11px] leading-relaxed italic text-[var(--fg-muted)] line-clamp-3">
      {children}
    </blockquote>
  );
}