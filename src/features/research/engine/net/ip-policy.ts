import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Which IP addresses the research worker may connect to: public unicast only.
 * Anything private, loopback, link-local (incl. cloud metadata at 169.254.169.254), shared,
 * multicast, reserved or used for documentation/benchmarking is refused, as are IPv6 addresses
 * outside global unicast and IPv6 forms that embed an arbitrary IPv4 address.
 */

const BLOCKED_IPV4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata services
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

// Only global unicast (2000::/3) is allowed; these ranges inside it are refused too.
const BLOCKED_IPV6: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments (Teredo, ORCHID, benchmarking, ...)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an arbitrary IPv4 address
  ["3fff::", 20], // documentation
];

const v4Blocked = new BlockList();
for (const [address, prefix] of BLOCKED_IPV4) v4Blocked.addSubnet(address, prefix, "ipv4");
const v6Blocked = new BlockList();
for (const [address, prefix] of BLOCKED_IPV6) v6Blocked.addSubnet(address, prefix, "ipv6");

/** Expands a valid IPv6 address (optionally ending in a dotted IPv4 part) into 8 hextets. */
function hextets(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    if (!isIPv4(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if ((halves.length === 1 && head.length !== 8) || fill < 0) return null;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => Number.parseInt(p, 16));
}

/** True only for public unicast addresses that the worker may connect to. */
export function isPublicAddress(address: string): boolean {
  const ip = address.trim().replace(/^\[(.*)\]$/, "$1");
  if (isIPv4(ip)) return !v4Blocked.check(ip, "ipv4");

  // Zone ids (fe80::1%eth0) only exist for link-local addresses.
  if (!isIPv6(ip) || ip.includes("%")) return false;
  const h = hextets(ip);
  if (!h) return false;

  // IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 address it points to.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return isPublicAddress(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
  }
  // Outside global unicast: ::, ::1, IPv4-compatible, NAT64 64:ff9b::/96, discard 100::/64,
  // unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
  if ((h[0] & 0xe000) !== 0x2000) return false;
  return !v6Blocked.check(h.map((x) => x.toString(16)).join(":"), "ipv6");
}
