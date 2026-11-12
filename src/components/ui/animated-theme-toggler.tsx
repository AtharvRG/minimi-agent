"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";

export type TransitionVariant =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "rectangle"
  | "star";

interface AnimatedThemeTogglerProps
  extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number;
  variant?: TransitionVariant;
  fromCenter?: boolean;
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark") => void;
}

function getCircleClipPaths(
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number
): [string, string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const point = `${toX(cx)} ${toY(cy)}`;
  const toRadius = (r: number) =>
    `${(r / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;

  return [
    `circle(0% at ${point})`,
    `circle(${toRadius(maxRadius)} at ${point})`,
  ];
}

export const AnimatedThemeToggler = ({
  className,
  duration = 900,
  fromCenter = false,
  theme,
  onThemeChange,
  ...props
}: AnimatedThemeTogglerProps) => {
  const isControlled = theme !== undefined;
  const [internalIsDark, setInternalIsDark] = useState(true);
  const isDark = isControlled ? theme === "dark" : internalIsDark;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isTransitioningRef = useRef(false);
  const activeAnimRef = useRef<Animation | null>(null);

  const cancelAnim = useCallback(() => {
    activeAnimRef.current?.cancel();
    activeAnimRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelAnim();
      const root = document.documentElement;
      if (root.dataset.magicuiThemeVt !== "active") return;
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty("--magicui-theme-toggle-vt-duration");
    };
  }, [cancelAnim]);

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current;
    if (
      !button ||
      isTransitioningRef.current ||
      document.documentElement.dataset.magicuiThemeVt === "active"
    )
      return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x: number;
    let y: number;
    if (fromCenter) {
      x = viewportWidth / 2;
      y = viewportHeight / 2;
    } else {
      const { top, left, width, height } = button.getBoundingClientRect();
      x = left + width / 2;
      y = top + height / 2;
    }

    const maxRadius =
      Math.hypot(
        Math.max(x, viewportWidth - x),
        Math.max(y, viewportHeight - y)
      ) * 1.05;

    const applyTheme = () => {
      const nextIsDark = !isDark;
      const nextThemeStr = nextIsDark ? "dark" : "light";
      document.documentElement.classList.toggle("dark", nextIsDark);
      document.documentElement.setAttribute("data-theme", nextThemeStr);
      localStorage.setItem("minimi-theme", nextThemeStr);
      if (isControlled) {
        onThemeChange?.(nextThemeStr);
      } else {
        setInternalIsDark(nextIsDark);
      }
    };

    const docWithVt = document as Document & {
      startViewTransition?: (cb: () => void) => {
        ready: Promise<void>;
        finished: Promise<void>;
      };
    };

    if (typeof docWithVt.startViewTransition !== "function") {
      applyTheme();
      return;
    }

    const clipPath = getCircleClipPaths(
      x,
      y,
      maxRadius,
      viewportWidth,
      viewportHeight
    );

    const root = document.documentElement;
    root.dataset.magicuiThemeVt = "active";
    root.style.setProperty(
      "--magicui-theme-toggle-vt-duration",
      `${duration}ms`
    );

    const cleanup = () => {
      isTransitioningRef.current = false;
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty("--magicui-theme-toggle-vt-duration");
      cancelAnim();
    };

    isTransitioningRef.current = true;
    const transition = docWithVt.startViewTransition(() => {
      flushSync(applyTheme);
    });

    if (typeof transition?.finished?.finally === "function") {
      transition.finished.finally(cleanup).catch(() => {});
    } else {
      cleanup();
    }

    const ready = transition?.ready;
    if (ready && typeof ready.then === "function") {
      ready
        .then(() => {
          const anim = document.documentElement.animate(
            { clipPath },
            {
              duration,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
              fill: "forwards",
              pseudoElement: "::view-transition-new(root)",
            }
          );
          activeAnimRef.current = anim;
        })
        .catch(() => {});
    }
  }, [fromCenter, duration, isDark, isControlled, onThemeChange, cancelAnim]);

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={toggleTheme}
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-full border border-[var(--border-hairline)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] cursor-pointer overflow-hidden",
        className
      )}
      {...props}
    >
      <Sun
        className={cn(
          "size-3.5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          isDark
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-90 scale-50 opacity-0 absolute"
        )}
      />
      <Moon
        className={cn(
          "size-3.5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          !isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-50 opacity-0 absolute"
        )}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
};