import { lookup } from "node:dns/promises";
import { ResearchFetchError, toFetchError } from "./errors.ts";
import { isPublicAddress } from "./ip-policy.ts";

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** Looks up every address of a hostname. Injectable so tests never use real DNS. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Resolves a hostname and returns the single address the request will be pinned to.
 * Every returned address must be public: if any of them is private or reserved the host is
 * refused, so a DNS answer mixing public and internal addresses cannot be used to reach the
 * internal one. The caller connects to exactly this address (see transport.ts), which is what
 * defeats DNS rebinding: the name is never looked up again for the same connection.
 */
export async function resolvePublicAddress(
  hostname: string,
  resolver: Resolver = systemResolver,
): Promise<ResolvedAddress> {
  let records: ResolvedAddress[];
  try {
    records = await resolver(hostname);
  } catch (error) {
    throw toFetchError(error, `https://${hostname}/`);
  }
  if (records.length === 0) {
    throw new ResearchFetchError("dns_not_found", `The domain ${hostname} has no addresses`);
  }
  if (records.some((r) => !isPublicAddress(r.address))) {
    throw new ResearchFetchError(
      "blocked_address",
      `${hostname} resolves to a private or reserved network address and was not contacted`,
    );
  }
  return records.find((r) => r.family === 4) ?? records[0];
}
