/**
 * Canonical lead fields a spreadsheet column can map to (spec §8 "Canonical
 * fields to support"). Values are stored per row in import_rows.mapped_data
 * under these keys; the database derives duplicate keys from company_name,
 * website, business_email, phone, city and state (migration 005). The leads
 * table does not exist yet, so nothing here implies a leads column.
 */

export const LEAD_FIELDS = [
  { key: "company_name", label: "Company name", required: true },
  { key: "website", label: "Website" },
  { key: "business_email", label: "Business email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Street address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "ZIP / postal code" },
  { key: "country", label: "Country" },
  { key: "contact_full_name", label: "Contact full name" },
  { key: "contact_first_name", label: "Contact first name" },
  { key: "contact_last_name", label: "Contact last name" },
  { key: "job_title", label: "Job title" },
  { key: "services", label: "Services / industry" },
  { key: "source_url", label: "Source URL" },
  { key: "source_name", label: "Source name" },
  { key: "existing_lead_status", label: "Existing lead status" },
  { key: "notes", label: "Notes" },
] as const satisfies readonly { key: string; label: string; required?: boolean }[];

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];
export const REQUIRED_FIELDS: LeadFieldKey[] = ["company_name"];

export function fieldLabel(key: LeadFieldKey) {
  return LEAD_FIELDS.find((field) => field.key === key)?.label ?? key;
}

/** Column index → field key. Unmapped columns are simply absent. */
export type ColumnMapping = Record<number, LeadFieldKey>;

// Header synonyms, compared after lower-casing and stripping non-alphanumerics.
const SYNONYMS: Record<LeadFieldKey, string[]> = {
  company_name: [
    "company",
    "companyname",
    "business",
    "businessname",
    "name",
    "organization",
    "organisation",
    "account",
    "accountname",
    "firm",
    "dba",
  ],
  website: ["website", "web", "site", "url", "websiteurl", "homepage", "domain", "webaddress"],
  business_email: [
    "email",
    "emailaddress",
    "businessemail",
    "workemail",
    "contactemail",
    "mail",
    "email1",
  ],
  phone: [
    "phone",
    "phonenumber",
    "telephone",
    "tel",
    "mobile",
    "cell",
    "businessphone",
    "mainphone",
    "phone1",
  ],
  address: ["address", "streetaddress", "street", "address1", "addressline1", "fulladdress"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region", "st", "stateprovince"],
  postal_code: ["zip", "zipcode", "postalcode", "postcode", "postal"],
  country: ["country", "countrycode"],
  contact_full_name: [
    "contact",
    "contactname",
    "fullname",
    "owner",
    "ownername",
    "decisionmaker",
    "contactperson",
  ],
  contact_first_name: ["firstname", "first", "fname", "givenname"],
  contact_last_name: ["lastname", "last", "lname", "surname", "familyname"],
  job_title: ["title", "jobtitle", "position", "role"],
  services: [
    "services",
    "service",
    "industry",
    "category",
    "categories",
    "specialty",
    "specialties",
  ],
  source_url: [
    "sourceurl",
    "source link",
    "listingurl",
    "profileurl",
    "googlemapsurl",
    "mapsurl",
  ].map((s) => s.replace(/\W/g, "")),
  source_name: ["source", "sourcename", "leadsource", "list"],
  existing_lead_status: ["status", "leadstatus", "stage"],
  notes: ["notes", "note", "comments", "comment", "description", "remarks"],
};

const squash = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Suggest a mapping from headers. Exact synonym matches win; each field is used
 * at most once (first matching column). Users can change every suggestion.
 */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<LeadFieldKey>();
  const keys = Object.keys(SYNONYMS) as LeadFieldKey[];
  headers.forEach((header, index) => {
    const h = squash(header);
    if (!h) return;
    const field = keys.find((key) => !used.has(key) && SYNONYMS[key].includes(h));
    if (field) {
      mapping[index] = field;
      used.add(field);
    }
  });
  return mapping;
}

/** Fields mapped by more than one column (not allowed). */
export function duplicateMappings(mapping: ColumnMapping): LeadFieldKey[] {
  const seen = new Map<LeadFieldKey, number>();
  for (const field of Object.values(mapping)) seen.set(field, (seen.get(field) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([field]) => field);
}

export function missingRequired(mapping: ColumnMapping): LeadFieldKey[] {
  const mapped = new Set(Object.values(mapping));
  return REQUIRED_FIELDS.filter((field) => !mapped.has(field));
}
