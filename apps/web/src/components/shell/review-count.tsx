"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const Ctx = createContext<{ count: number; adjust: (delta: number) => void }>({ count: 0, adjust: () => {} });

/** The Review badge: starts from the server count, polls, and moves instantly on review actions. */
export function ReviewCountProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const [count, setCount] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/app/review/count", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (typeof body.count === "number") setCount(body.count);
    } catch {
      // Offline or signed out: keep the last known count.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 30_000);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const adjust = useCallback((delta: number) => setCount((c) => Math.max(0, c + delta)), []);
  return <Ctx.Provider value={{ count, adjust }}>{children}</Ctx.Provider>;
}

export const useReviewCount = () => useContext(Ctx);

export function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}
