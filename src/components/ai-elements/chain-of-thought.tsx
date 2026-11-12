"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown, Circle } from "lucide-react";
import React from "react";

export type ChainOfThoughtItemProps = React.ComponentProps<"div">;

export const ChainOfThoughtItem = ({
  children,
  className,
  ...props
}: ChainOfThoughtItemProps) => (
  <div
    className={cn("text-[var(--fg-secondary)] text-[12.5px] leading-5 font-tech", className)}
    {...props}
  >
    {children}
  </div>
);

export type ChainOfThoughtTriggerProps = React.ComponentProps<
  typeof CollapsibleTrigger
> & {
  leftIcon?: React.ReactNode;
  swapIconOnHover?: boolean;
};

export const ChainOfThoughtTrigger = ({
  children,
  className,
  leftIcon,
  swapIconOnHover = true,
  ...props
}: ChainOfThoughtTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] flex cursor-pointer items-center justify-start gap-1 text-left text-[13px] transition-colors duration-150",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      {leftIcon ? (
        <span className="relative inline-flex size-4 items-center justify-center">
          <span
            className={cn(
              "transition-opacity duration-150",
              swapIconOnHover && "group-hover:opacity-0"
            )}
          >
            {leftIcon}
          </span>
          {swapIconOnHover && (
            <ChevronDown className="absolute size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[state=open]:rotate-180" />
          )}
        </span>
      ) : (
        <span className="relative inline-flex size-4 items-center justify-center">
          <Circle className="size-1.5 fill-current" />
        </span>
      )}
      <span>{children}</span>
    </div>
    {!leftIcon && (
      <ChevronDown className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-180" />
    )}
  </CollapsibleTrigger>
);

export type ChainOfThoughtContentProps = React.ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = ({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) => {
  return (
    <CollapsibleContent
      className={cn("overflow-hidden", className)}
      {...props}
    >
      <div className="grid grid-cols-[min-content_minmax(0,1fr)] gap-x-4">
        <div className="bg-[var(--border-strong)] ml-1.75 h-full w-px group-data-[last=true]:hidden" />
        <div className="ml-1.75 h-full w-px bg-transparent group-data-[last=false]:hidden" />
        <div className="mt-1.5 space-y-1.5 pb-1">{children}</div>
      </div>
    </CollapsibleContent>
  );
};

export type ChainOfThoughtProps = {
  children: React.ReactNode;
  className?: string;
};

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  const childrenArray = React.Children.toArray(children);

  return (
    <div className={cn("space-y-0", className)}>
      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>
          {React.isValidElement(child) &&
            React.cloneElement(
              child as React.ReactElement<ChainOfThoughtStepProps>,
              {
                isLast: index === childrenArray.length - 1,
              }
            )}
        </React.Fragment>
      ))}
    </div>
  );
}

export type ChainOfThoughtStepProps = {
  children: React.ReactNode;
  className?: string;
  isLast?: boolean;
};

export const ChainOfThoughtStep = ({
  children,
  className,
  isLast = false,
  ...props
}: ChainOfThoughtStepProps & React.ComponentProps<typeof Collapsible>) => {
  return (
    <Collapsible
      className={cn("group", className)}
      data-last={isLast}
      {...props}
    >
      {children}
      <div className="flex justify-start group-data-[last=true]:hidden">
        <div className="bg-[var(--border-strong)] ml-1.75 h-3 w-px" />
      </div>
    </Collapsible>
  );
};