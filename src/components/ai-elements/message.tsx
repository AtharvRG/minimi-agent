"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationSource,
  InlineCitationQuote,
} from "./inline-citation";

export interface CitationItem {
  number: string;
  title: string;
  url: string;
  snippet?: string;
  quote?: string;
}

function renderTextWithInlineCitations(
  children: React.ReactNode,
  citations?: CitationItem[]
): React.ReactNode {
  if (!citations || citations.length === 0) return children;

  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;

    const parts = child.split(/(\[\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const num = match[1];
        const found = citations.find((c) => c.number === num);
        if (found) {
          return (
            <InlineCitation key={idx}>
              <InlineCitationCard>
                <InlineCitationCardTrigger
                  sources={[found.url]}
                  label={num}
                />
                <InlineCitationCardBody>
                  <InlineCitationCarousel>
                    <InlineCitationCarouselHeader>
                      <InlineCitationCarouselIndex />
                    </InlineCitationCarouselHeader>
                    <InlineCitationCarouselContent>
                      <InlineCitationCarouselItem>
                        <InlineCitationSource
                          title={found.title}
                          url={found.url}
                          description={found.snippet}
                        />
                        {found.quote && (
                          <InlineCitationQuote>
                            {found.quote}
                          </InlineCitationQuote>
                        )}
                      </InlineCitationCarouselItem>
                    </InlineCitationCarouselContent>
                  </InlineCitationCarousel>
                </InlineCitationCardBody>
              </InlineCitationCard>
            </InlineCitation>
          );
        }
      }
      return part;
    });
  });
}

export function MessageResponse({
  children,
  citations,
  className = "",
}: {
  children: string;
  citations?: CitationItem[];
  className?: string;
}) {
  return (
    <div className={`text-[15px] leading-7 text-[var(--fg-primary)] ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: pChildren }) => (
            <p className="mb-4 last:mb-0 leading-7 text-[var(--fg-primary)]">
              {renderTextWithInlineCitations(pChildren, citations)}
            </p>
          ),
          li: ({ children: liChildren }) => (
            <li className="leading-7 text-[var(--fg-primary)]">
              {renderTextWithInlineCitations(liChildren, citations)}
            </li>
          ),
          ul: ({ children: ulChildren }) => (
            <ul className="list-disc pl-5 mb-4 space-y-1.5">{ulChildren}</ul>
          ),
          ol: ({ children: olChildren }) => (
            <ol className="list-decimal pl-5 mb-4 space-y-1.5">{olChildren}</ol>
          ),
          h1: ({ children: hChildren }) => (
            <h1 className="font-editorial text-[24px] font-normal tracking-tight text-[var(--fg-primary)] mt-6 mb-3 pb-2 border-b border-[var(--border-hairline)]">
              {hChildren}
            </h1>
          ),
          h2: ({ children: hChildren }) => (
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--fg-primary)] mt-6 mb-2.5">
              {hChildren}
            </h2>
          ),
          h3: ({ children: hChildren }) => (
            <h3 className="text-[15px] font-semibold text-[var(--fg-primary)] mt-4 mb-1.5">
              {hChildren}
            </h3>
          ),
          strong: ({ children: sChildren }) => (
            <strong className="font-semibold text-[var(--fg-primary)]">
              {sChildren}
            </strong>
          ),
          a: ({ href, children: aChildren }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--fg-primary)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--accent-vermilion)] transition-colors duration-150"
            >
              {aChildren}
            </a>
          ),
          code: ({ className: codeClass, children: cChildren }) => {
            const isBlock = codeClass?.includes("language-");
            if (isBlock) {
              return (
                <pre className="bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded-xl p-4 overflow-x-auto my-4 text-[13px] leading-6 font-tech text-[var(--fg-primary)]">
                  <code>{cChildren}</code>
                </pre>
              );
            }
            return (
              <code className="bg-[var(--bg-pill)] text-[var(--fg-primary)] px-1.5 py-0.5 rounded-md text-[13px] font-tech">
                {cChildren}
              </code>
            );
          },
          table: ({ children: tChildren }) => (
            <div className="overflow-x-auto my-5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]">
              <table className="w-full text-left border-collapse text-[13.5px] leading-6">
                {tChildren}
              </table>
            </div>
          ),
          thead: ({ children: thChildren }) => (
            <thead className="border-b border-[var(--border-hairline)] text-[var(--fg-secondary)] font-tech text-[11px] uppercase tracking-wider">
              {thChildren}
            </thead>
          ),
          th: ({ children: thChildren }) => (
            <th className="px-4 py-3 font-medium">{thChildren}</th>
          ),
          td: ({ children: tdChildren }) => (
            <td className="px-4 py-3 border-t border-[var(--border-hairline)] text-[var(--fg-primary)] align-top">
              {renderTextWithInlineCitations(tdChildren, citations)}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}