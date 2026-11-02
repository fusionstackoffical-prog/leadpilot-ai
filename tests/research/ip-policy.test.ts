import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicAddress } from "../../src/features/research/engine/net/ip-policy.ts";

const PUBLIC = [
  "8.8.8.8",
  "1.1.1.1",
  "93.184.215.14",
  "100.63.255.255", // just below carrier-grade NAT
  "100.128.0.0", // just above it
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "198.17.255.255",
  "198.20.0.0",
  "223.255.255.255",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2a00:1450:4001:80b::200e",
  "2600::1",
  "[2606:4700::1111]",
  "::ffff:8.8.8.8", // IPv4-mapped public address
];

const BLOCKED = [
  // IPv4
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254", // cloud metadata
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.8",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.7",
  "203.0.113.9",
  "224.0.0.1",
  "239.255.255.250",
  "240.0.0.1",
  "255.255.255.255",
  // IPv6
  "::",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1", // mapped loopback, hex form
  "::ffff:10.0.0.1",
  "::ffff:169.254.169.254",
  "::127.0.0.1", // IPv4-compatible (deprecated)
  "64:ff9b::7f00:1", // NAT64
  "100::1", // discard
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fe80::1%eth0",
  "fec0::1",
  "ff02::1",
  "2001:db8::1",
  "2001::1", // Teredo
  "2001:10::1", // ORCHID
  "2002:7f00:1::1", // 6to4 wrapping 127.0.0.1
  "3fff::1",
  "4000::1", // outside global unicast
];

const NOT_ADDRESSES = [
  "",
  "localhost",
  "example.com",
  "999.1.1.1",
  "1.2.3",
  "::g",
  "1.2.3.4.5",
  "01.02.03.04",
];

describe("isPublicAddress", () => {
  for (const ip of PUBLIC) it(`allows ${ip}`, () => assert.equal(isPublicAddress(ip), true));
  for (const ip of BLOCKED) it(`blocks ${ip}`, () => assert.equal(isPublicAddress(ip), false));
  for (const value of NOT_ADDRESSES)
    it(`rejects non-address "${value}"`, () => assert.equal(isPublicAddress(value), false));
});
