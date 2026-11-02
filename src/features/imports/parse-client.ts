"use client";

import type { ImportFileType } from "./file-rules.ts";
import type { ParseResult } from "./parse.ts";

const WORKER_TIMEOUT_MS = 60_000;

/** Parse in a Web Worker; fall back to the main thread if workers are unavailable or stall. */
export async function parseFile(
  buffer: ArrayBuffer,
  fileType: ImportFileType,
): Promise<ParseResult> {
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise<ParseResult>((resolve, reject) => {
        // Keep this exact form: Turbopack only compiles new Worker(new URL("./x", import.meta.url)).
        const worker = new Worker(new URL("./parse.worker", import.meta.url));
        // If the worker never answers (blocked or crashed), fall back instead of hanging.
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Parser worker did not respond"));
        }, WORKER_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<ParseResult>) => {
          clearTimeout(timer);
          resolve(event.data);
          worker.terminate();
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          event.preventDefault();
          reject(new Error(event.message));
          worker.terminate();
        };
        // Copy, so the caller's buffer stays usable for hashing and upload.
        worker.postMessage({ buffer: buffer.slice(0), fileType });
      });
    } catch (error) {
      console.warn("Import parser worker unavailable; parsing on the main thread.", error);
    }
  }
  const { parseSpreadsheet } = await import("./parse.ts");
  return parseSpreadsheet(buffer, fileType);
}
