"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <ErrorState
        title="This page couldn't load"
        description={
          <>
            A server error occurred. Your data has not been changed.
            {error.digest ? (
              <span className="mt-1 block text-fg-muted">Reference: {error.digest}</span>
            ) : null}
          </>
        }
        action={
          <Button size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </Button>
        }
      />
    </div>
  );
}
