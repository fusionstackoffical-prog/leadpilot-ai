// Test doubles for the research fetcher: an in-memory DNS and HTTP layer. Nothing here touches
// the real network. Addresses are public-looking so the real IP policy is exercised unchanged.
import { Readable } from "node:stream";
import type { Clock } from "../../src/features/research/engine/net/host-limiter.ts";
import type { ResolvedAddress, Resolver } from "../../src/features/research/engine/net/resolve.ts";
import type {
  Transport,
  TransportRequest,
} from "../../src/features/research/engine/net/transport.ts";

export const PUBLIC_V4 = "93.184.215.14";
export const PUBLIC_V4_B = "151.101.1.69";

export type FakeRoute = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | Buffer[];
  /** Never answer (until the request is aborted). */
  hang?: boolean;
  /** Send the first body chunk, then stall until aborted. */
  stallBody?: boolean;
};

export function fakeResolver(table: Record<string, string[] | (() => string[]) | Error>) {
  const calls: string[] = [];
  const resolver: Resolver = async (hostname) => {
    calls.push(hostname);
    const entry = table[hostname];
    if (entry instanceof Error) throw entry;
    if (!entry)
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    const list = typeof entry === "function" ? entry() : entry;
    return list.map((address): ResolvedAddress => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  };
  return { resolver, calls };
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("aborted"), { name: "AbortError" });
}

export function fakeTransport(routes: Record<string, FakeRoute>) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    const key = `${request.url.host}${request.url.pathname}${request.url.search}`;
    const route = routes[key] ?? {
      status: 404,
      body: "not found",
      headers: { "content-type": "text/plain" },
    };
    if (route.hang) {
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(abortError(request.signal)), {
          once: true,
        });
      });
    }
    const chunks =
      route.body === undefined
        ? []
        : Array.isArray(route.body)
          ? route.body
          : [Buffer.from(route.body)];
    let body: Readable;
    if (route.stallBody) {
      body = new Readable({ read() {} });
      if (chunks[0]) body.push(chunks[0]);
      request.signal.addEventListener("abort", () => body.destroy(abortError(request.signal)), {
        once: true,
      });
    } else {
      body = Readable.from(chunks);
    }
    return {
      status: route.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...route.headers },
      body,
      remoteAddress: request.address,
    };
  };
  return { transport, requests };
}

/** A manual clock: sleep() advances time instantly and records each pause. */
export function fakeClock(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (now += ms) };
}

export const UA = "LeadPilotResearchBot/1.0 (+https://leadpilot.example.com/bot)";
