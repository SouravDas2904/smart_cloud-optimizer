"use client";

import { useEffect } from "react";

/** One pointer listener for the whole app: tells the card under the cursor where the cursor is,
 *  so its border glow (.card::before in globals.css) follows the mouse. */
export function Spotlight() {
  useEffect(() => {
    let last: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.(".card") as HTMLElement | null;
      if (last && last !== card) { last.style.removeProperty("--mx"); last.style.removeProperty("--my"); }
      last = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return null;
}
