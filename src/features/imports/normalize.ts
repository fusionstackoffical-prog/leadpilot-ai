/**
 * TypeScript mirror of the database normalizers in migration 005
 * (private.normalize_text/_domain/_email/_phone/_us_state). The database stays
 * the source of truth: it recomputes every key on insert. These copies let the
 * UI explain validation problems before anything is stored. Keep them in step;
 * the live parity test compares both on the same inputs.
 */

export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value
    .replace(/[\s  -​　]+/g, " ")
    .replace(/^ +| +$/g, "")
    .toLowerCase();
  return text === "" ? null : text;
}

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeDomain(value: string | null | undefined): string | null {
  let d = normalizeText(value);
  if (d == null) return null;
  d = d
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^\/\//, "")
    .replace(/[/?#\s].*$/, "")
    .replace(/^.*@/, "")
    .replace(/:[0-9]*$/, "")
    .replace(/\.+$/, "")
    .replace(/^www\./, "");
  return d.length >= 4 && d.length <= 253 && DOMAIN_RE.test(d) ? d : null;
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export function normalizeEmail(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (text == null) return null;
  const email = text.replace(/^mailto:/, "");
  return email.length <= 320 && EMAIL_RE.test(email) ? email : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  let s = normalizeText(value);
  if (s == null) return null;
  s = s.replace(/\s*(ext\.?|extension|x|#)\s*[0-9]+\s*$/, "");
  const digits = s.replace(/[^0-9]/g, "");
  if (s.startsWith("+")) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) return `+${digits}`;
  return null;
}

const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  "washington dc": "DC",
  "washington d.c.": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "puerto rico": "PR",
  guam: "GU",
  "u.s. virgin islands": "VI",
  "us virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};

/** Two-letter codes the database maps to (US states, DC and territories). */
export const US_STATE_CODES = new Set(Object.values(US_STATES));

export function normalizeUsState(value: string | null | undefined): string | null {
  const n = normalizeText(value);
  if (n == null) return null;
  if (US_STATES[n]) return US_STATES[n];
  if (/^[a-z]{2}\.?$/.test(n)) return n.slice(0, 2).toUpperCase();
  return n.toUpperCase();
}
