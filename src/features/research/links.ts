/**
 * Turns an imported website value into a safe external link, or null.
 *
 * Imported values are untrusted: only http(s) URLs with a real-looking host become links, so a
 * value such as `javascript:...` or `data:...` is shown as text and never made clickable.
 * Bare domains ("acme-hvac.com") are assumed to be https.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(hasScheme ? raw : `https://${raw.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // Require a dotted hostname with a letter-only TLD: no localhost, IPs or single labels.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) return null;
  return url.href;
}

/** Hostname for compact display ("www." removed), or the raw value if it is not a safe URL. */
export function displayHost(value: string | null | undefined): string | null {
  const href = safeExternalUrl(value);
  if (!href) return value?.trim() || null;
  return new URL(href).hostname.replace(/^www\./i, "");
}
