"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page while the pilot's videos are still being analysed. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
