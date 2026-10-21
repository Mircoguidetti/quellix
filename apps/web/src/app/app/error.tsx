"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/app/error-state";
import { PageContainer } from "@/components/app/page-header";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <ErrorState
        title="This page could not load"
        description="We could not reach your workspace data. It is usually a short outage; try again in a moment. If it keeps happening, contact support."
        onRetry={retry}
      />
    </PageContainer>
  );
}
