"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// A short fade-and-rise when the page changes. The animation is restarted by
// toggling a class rather than re-keying the tree, so pages and any layouts
// shared between them keep their state (filters, scroll, open forms).
export function PageTransition({ children, className = "" }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("animate-page-in");
    void el.offsetWidth; // restart the animation
    el.classList.add("animate-page-in");
  }, [pathname]);

  return (
    <main ref={ref} className={className}>
      {children}
    </main>
  );
}
