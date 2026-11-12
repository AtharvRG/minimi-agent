"use client";

import React, { useRef, useEffect, useState, createContext, useContext } from "react";
import { ArrowDownIcon } from "lucide-react";

interface ConversationContextValue {
  scrollToBottom: () => void;
  isAtBottom: boolean;
}

const ConversationContext = createContext<ConversationContextValue>({
  scrollToBottom: () => {},
  isAtBottom: true,
});

export function Conversation({
  children,
  className = "",
}: React.HTMLAttributes<HTMLDivElement>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 60;
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
      setIsAtBottom(atBottom);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <ConversationContext.Provider value={{ scrollToBottom, isAtBottom }}>
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-y-auto scroll-smooth ${className}`}
      >
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({
  children,
  className = "",
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col gap-6 p-4 md:p-6 ${className}`}>
      {children}
    </div>
  );
}

export function ConversationScrollButton() {
  const { scrollToBottom, isAtBottom } = useContext(ConversationContext);
  if (isAtBottom) return null;

  return (
    <button
      type="button"
      onClick={scrollToBottom}
      aria-label="Scroll to bottom"
      className="fixed bottom-28 right-8 z-20 rounded-full border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 shadow-lg hover:bg-zinc-800 transition cursor-pointer"
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}