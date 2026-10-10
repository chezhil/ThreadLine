"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useShell } from "./ShellProvider";

const ROOT_FONT: Record<string, string> = { small: "87.5%", default: "100%", large: "112.5%" };
// Page and scrollbar colours that live outside the frame (the <html>/<body>
// the browser paints behind and around it).
const DARK_PAGE = "html{color-scheme:dark}body{background:#0f1216}";

// The outermost box of the signed-in app. It carries the user's theme, text
// size and motion preferences as data attributes, which globals.css turns
// into colour tokens and animation rules. The page-level rules (root font
// size, native scrollbar scheme) can't live on a div, so they ship as an
// inline <style> rendered with the frame: the server renders it from the
// stored preferences, so the first paint is already right.
export function ShellFrame({ children }: { children: ReactNode }) {
  const { prefs } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  // Marks the shell as interactive (event handlers attached). Keyboard
  // shortcuts only work from this point, so tests and scripts wait for it.
  useEffect(() => {
    ref.current?.setAttribute("data-ready", "1");
  }, []);
  const css = [
    prefs.textSize !== "default" ? `html{font-size:${ROOT_FONT[prefs.textSize]}}` : "",
    prefs.theme === "dark" ? DARK_PAGE : "",
    prefs.theme === "system" ? `@media (prefers-color-scheme: dark){${DARK_PAGE}}` : "",
  ].join("");

  return (
    <div
      ref={ref}
      data-theme={prefs.theme}
      data-text={prefs.textSize}
      data-motion={prefs.reduceMotion ? "reduced" : "full"}
      className="flex min-h-screen w-full bg-background text-foreground"
    >
      {css && <style>{css}</style>}
      {children}
    </div>
  );
}
