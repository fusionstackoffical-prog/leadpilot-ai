// The real Node transport against a local test server. These tests call the transport
// directly (bypassing the address policy, which refuses loopback by design) to prove that the
// connection goes to the pinned address and never through DNS.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { ResearchFetchError } from "../../src/features/research/engine/net/errors.ts";
import { nodeTransport } from "../../src/features/research/engine/net/transport.ts";

let server: Server;
let port = 0;
const seen: { host?: string; headers: IncomingHttpHeaders }[] = [];

before(async () => {
  server = createServer((req, res) => {
    seen.push({ host: req.headers.host, headers: req.headers });
    if (req.url === "/hang") return; // never respond
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<p>local</p>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

after(() => server.close());

async function readAll(stream: AsyncIterable<unknown>) {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(parts).toString();
}

describe("nodeTransport", () => {
  it("connects to the pinned address without resolving the hostname", async () => {
    // This hostname cannot resolve (.invalid is reserved); success proves DNS was not used.
    const url = new URL(`http://pinned-check.invalid:${port}/page`);
    const res = await nodeTransport({
      url,
      address: "127.0.0.1",
      family: 4,
      headers: { "user-agent": "LeadPilotResearchBot/1.0 (+https://leadpilot.example.com/bot)" },
      signal: new AbortController().signal,
      connectTimeoutMs: 2_000,
    });
    assert.equal(res.status, 200);
    assert.equal(await readAll(res.body), "<p>local</p>");
    assert.equal(res.remoteAddress, "127.0.0.1");
    const last = seen.at(-1);
    assert.equal(last?.host, `pinned-check.invalid:${port}`); // Host header keeps the hostname
    assert.equal(
      last?.headers["user-agent"],
      "LeadPilotResearchBot/1.0 (+https://leadpilot.example.com/bot)",
    );
    assert.equal(last?.headers.cookie, undefined);
  });

  it("is aborted by the caller's signal", async () => {
    const controller = new AbortController();
    const pending = nodeTransport({
      url: new URL(`http://abort-check.invalid:${port}/hang`),
      address: "127.0.0.1",
      family: 4,
      headers: { "user-agent": "test" },
      signal: controller.signal,
      connectTimeoutMs: 2_000,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, (e: ResearchFetchError) => e.code === "cancelled");
  });

  it("reports a refused connection as retryable", async () => {
    const closed = createServer();
    closed.listen(0, "127.0.0.1");
    await once(closed, "listening");
    const deadPort = (closed.address() as AddressInfo).port;
    closed.close();
    await once(closed, "close");
    await assert.rejects(
      nodeTransport({
        url: new URL(`http://refused-check.invalid:${deadPort}/`),
        address: "127.0.0.1",
        family: 4,
        headers: { "user-agent": "test" },
        signal: new AbortController().signal,
        connectTimeoutMs: 2_000,
      }),
      (e: ResearchFetchError) => e.code === "connection_failed" && e.retryable,
    );
  });
});
