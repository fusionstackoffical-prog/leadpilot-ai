/// <reference lib="webworker" />
import type { ImportFileType } from "./file-rules.ts";
import { parseSpreadsheet } from "./parse.ts";

// Parses off the main thread so large workbooks don't freeze the page.
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; fileType: ImportFileType }>) => {
  const { buffer, fileType } = event.data;
  try {
    self.postMessage(parseSpreadsheet(buffer, fileType));
  } catch {
    self.postMessage({ ok: false, error: "This file couldn't be read." });
  }
};
