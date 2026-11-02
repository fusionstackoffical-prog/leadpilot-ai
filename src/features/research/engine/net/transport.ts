import http from "node:http";
import https from "node:https";
import type { LookupFunction, Socket } from "node:net";
import type { Readable } from "node:stream";
import { ResearchFetchError, toFetchError } from "./errors.ts";

export type TransportRequest = {
  url: URL;
  /** The already-validated address to connect to. DNS is never consulted again. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
  connectTimeoutMs: number;
};

export type TransportResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
  remoteAddress: string | undefined;
};

/** Performs one HTTP request. Injectable so policy tests never touch the network. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

const normalize = (address: string | undefined) =>
  (address ?? "").replace(/^::ffff:/i, "").toLowerCase();

/**
 * Node's http/https client, pinned to the validated address: the custom `lookup` hands the
 * socket that address instead of resolving the hostname again, so a DNS answer that changes
 * between validation and connection (DNS rebinding) has no effect. The hostname is still used
 * for the Host header, TLS SNI and certificate verification. As a second check, the socket's
 * actual remote address must equal the pinned one.
 */
export const nodeTransport: Transport = (request) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const { url, address, family } = request;
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "GET",
      headers: request.headers,
      agent: false,
      lookup,
      signal: request.signal,
    });

    req.on("socket", (socket: Socket) => {
      const timer = setTimeout(() => {
        req.destroy(
          new ResearchFetchError(
            "connect_timeout",
            `Could not connect to ${url.host} within ${request.connectTimeoutMs / 1000} s`,
            {
              url: url.href,
            },
          ),
        );
      }, request.connectTimeoutMs);
      const onConnect = () => {
        clearTimeout(timer);
        if (normalize(socket.remoteAddress) !== normalize(address)) {
          req.destroy(
            new ResearchFetchError(
              "blocked_address",
              `Connection to ${url.host} reached an unexpected address`,
              {
                url: url.href,
              },
            ),
          );
        }
      };
      if (socket.remoteAddress) onConnect();
      else socket.once("connect", onConnect);
      socket.once("close", () => clearTimeout(timer));
    });

    req.on("response", (res) => {
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: res,
        remoteAddress: res.socket?.remoteAddress,
      });
    });
    req.on("error", (error) => reject(toFetchError(error, url.href)));
    req.end();
  });
