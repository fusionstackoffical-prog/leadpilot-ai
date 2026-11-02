// The SHA-256/UUID fallbacks used when the page isn't a secure context (http://<LAN ip>).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { randomId, sha256, sha256Hex } from "../../src/features/imports/hashing.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const nodeSha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("fallback SHA-256 (no crypto.subtle)", () => {
  it("matches Node's crypto at padding boundaries and for large input", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 1_000_003]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      assert.equal(hex(sha256(data)), nodeSha(data), `length ${n}`);
    }
  });

  it("matches the FIPS test vector", () => {
    assert.equal(
      hex(sha256(new TextEncoder().encode("abc"))),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is used when crypto.subtle is missing, and agrees with it otherwise", async () => {
    const data = new TextEncoder().encode("Company,Website\nAcme,acme.com\n");
    const withSubtle = await sha256Hex(data);
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
    Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
    try {
      assert.equal(await sha256Hex(data), withSubtle);
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, "subtle", subtle);
    }
  });
});

describe("randomId (no crypto.randomUUID)", () => {
  it("returns RFC 4122 v4 UUIDs from getRandomValues", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 1000 }, randomId));
      assert.equal(ids.size, 1000);
      for (const id of ids)
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
