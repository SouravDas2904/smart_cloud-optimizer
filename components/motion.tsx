"use client";

import { useEffect, useRef, useState } from "react";

/** Counts up to `value` once, when first shown; later changes ease from the previous value. */
export function CountUp({ value, format, ms = 900 }: { value: number; format: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** Rupees spent on waste since the page was opened, ticking in real time. */
export function WasteTicker({ perMonth }: { perMonth: number }) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const perSec = perMonth / (30.42 * 86400);
  const spent = ((now - t0) / 1000) * perSec;
  return (
    <span className="tabular-nums">
      ₹{spent.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
