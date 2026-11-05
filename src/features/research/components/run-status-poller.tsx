"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { POLL_INTERVAL_MS, shouldPoll } from "../status";

/**
 * Keeps the page current while research is queued or running, and does nothing otherwise.
 *
 * Every POLL_INTERVAL_MS (8 s) it calls `router.refresh()`, which re-renders the server
 * components; no data is fetched from the browser. It runs only while `active` is true AND the
 * tab is visible: hiding the tab stops the timer, showing it again restarts it. When the run
 * reaches a final status the page re-renders with `active = false`, and the effect's cleanup
 * clears the timer and the listener. Nothing is left running after unmount.
 */
export function RunStatusPoller({
  active,
  intervalMs = POLL_INTERVAL_MS,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const sync = () => {
      if (shouldPoll(active, document.visibilityState)) {
        if (timer === null) timer = setInterval(() => router.refresh(), intervalMs);
      } else {
        stop();
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [active, intervalMs, router]);

  return null;
}
