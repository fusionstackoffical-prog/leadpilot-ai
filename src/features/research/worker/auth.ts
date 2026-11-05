import { createHash, timingSafeEqual } from "node:crypto";

/** Shorter secrets are treated as "not configured": they are too easy to guess. */
export const WORKER_SECRET_MIN_LENGTH = 32;

/**
 * Visible ASCII only (no spaces, tabs, line breaks, control or non-ASCII characters): the only
 * characters an `Authorization` header can carry reliably. A secret containing anything else
 * could never be sent by a client, so it is rejected up front instead of looking "configured"
 * while every call fails.
 */
const HEADER_SAFE_SECRET = /^[\x21-\x7e]+$/;

/**
 * The shared secret that protects the worker endpoint, from RESEARCH_WORKER_SECRET. null when it
 * is missing, shorter than WORKER_SECRET_MIN_LENGTH, or contains whitespace or any character
 * that cannot travel in a header; the worker then answers "not configured" and runs nothing.
 * Whitespace around the value is ignored. The value is never logged, returned or defaulted: the
 * owner creates it and puts it in .env.local (see docs/SETUP.md).
 */
export function loadWorkerSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.RESEARCH_WORKER_SECRET?.trim();
  if (!secret || secret.length < WORKER_SECRET_MIN_LENGTH) return null;
  return HEADER_SAFE_SECRET.test(secret) ? secret : null;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Checks an `Authorization: Bearer <secret>` header in constant time. Both values are hashed
 * first, so the comparison always sees equal-length input and does not reveal the secret's
 * length, and the comparison runs even when the header is missing or malformed.
 */
export function verifyWorkerSecret(
  authorization: string | null | undefined,
  secret: string,
): boolean {
  const match = /^Bearer[ \t]+(\S+)$/i.exec(authorization ?? "");
  const equal = timingSafeEqual(digest(match?.[1] ?? ""), digest(secret));
  return match !== null && equal;
}
