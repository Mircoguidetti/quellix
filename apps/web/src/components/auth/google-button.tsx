"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { GoogleLogo } from "./google-logo";

/** Asks the server for the Google consent URL, then leaves the page. Spinner until we do. */
export function GoogleButton({
  action,
  onError,
}: {
  action: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const res = await clientTimeout(action());
      if (!res.ok) {
        onError(res.error);
        setLoading(false);
        return;
      }
      window.location.assign(res.url);
      // If the browser does not leave within a few seconds, give the button back.
      setTimeout(() => setLoading(false), 8000);
    } catch {
      onError(NETWORK_ERROR);
      setLoading(false);
    }
  }
  return (
    <Button type="button" variant="pill-outline" size="lg" className="w-full bg-transparent" loading={loading} onClick={go}>
      <GoogleLogo className="!size-[18px]" />
      Continue with Google
    </Button>
  );
}
