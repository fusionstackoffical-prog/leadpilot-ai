// Research-finding fixtures for the AI analysis tests: six industries built the way migration 009
// stores them (including the engine's `company_detail` encoding for industry, product, company name,
// website and contact page).
import type { ResearchFindingInput } from "../../src/features/analysis/evidence-pack.ts";

export const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Kind = "fact" | "candidate" | "assessment";

export type FindingOptions = {
  id?: string;
  quote?: string | null;
  fieldKey?: string;
  valueJson?: ResearchFindingInput["value_json"];
  runId?: string;
};

/** Makes ids unique within one fixture set. */
export function makeBuilder(base: number, runId = `run-${base}`) {
  let n = 0;
  const next = () => uuidFor(base * 1000 + ++n);

  const make = (
    category: string,
    kind: Kind,
    value: string,
    options: FindingOptions = {},
  ): ResearchFindingInput => ({
    id: options.id ?? next(),
    run_id: options.runId ?? runId,
    category,
    kind,
    field_key: options.fieldKey ?? `${category}:${n}`,
    value_text: value,
    value_json: options.valueJson ?? null,
    evidence_quote: options.quote === undefined ? value : options.quote,
  });

  return {
    fact: (category: string, value: string, options?: FindingOptions) =>
      make(category, "fact", value, options),
    candidate: (category: string, value: string, options?: FindingOptions) =>
      make(category, "candidate", value, options),
    assessment: (category: string, value: string) =>
      make(category, "assessment", value, { quote: null }),
    /** industry / product / company_name / website / contact_page: stored as company_detail. */
    detail: (engineCategory: string, value: string, kind: "fact" | "candidate" = "fact") =>
      make("company_detail", kind, value, {
        fieldKey: `${engineCategory === "company_name" ? "name" : engineCategory}:${value.slice(0, 20)}`,
        valueJson: { category: engineCategory, method: "page-text" },
      }),
    social: (platform: string, url: string, kind: "fact" | "candidate" = "fact") =>
      make("social_profile", kind, url, {
        fieldKey: `social:${platform}`,
        valueJson: { category: "social_profile", method: "site-link", details: { platform } },
      }),
  };
}

export type IndustryFixture = {
  name: string;
  findings: ResearchFindingInput[];
  /** Ids that must never reach the model or an answer. */
  forbiddenIds: string[];
  /** Text that must never reach the model. */
  forbiddenText: string[];
};

function clinic(): IndustryFixture {
  const f = makeBuilder(1);
  const email = f.fact("contact_email", "reception@brightsmile-clinic.example");
  const phone = f.fact("contact_phone", "(555) 123-4567");
  const person = f.fact("person", "Dr. Jane Roe, Principal Dentist");
  const name = f.detail("company_name", "Bright Smile Dental Clinic");
  const site = f.detail("website", "https://brightsmile-clinic.example/");
  const assessment = f.assessment("observation", "The clinic looks busy.");
  // Address findings are never analyzed: a business address can be someone's home.
  const address = f.fact("contact_address", "12 Main Street, Austin TX 78701");
  const addressCandidate = f.candidate("contact_address", "Flat 4, 12 Main Street, Austin");
  return {
    name: "clinic",
    findings: [
      f.fact(
        "business_description",
        "Family dental clinic offering check-ups, whitening and emergency appointments. Call (555) 123-4567 or email reception@brightsmile-clinic.example to book.",
      ),
      f.detail("industry", "Dental clinic"),
      f.fact("service", "Teeth whitening"),
      f.fact("service", "Dental implants"),
      f.fact("service", "Emergency appointments"),
      f.candidate("service", "Children's dentistry"),
      f.fact("location", "Austin, TX"),
      f.fact("service_area", "Greater Austin and Round Rock"),
      address,
      addressCandidate,
      f.social("facebook", "https://facebook.com/brightsmileatx"),
      f.candidate("business_description", "Our patients trust us for gentle care."),
      email,
      phone,
      person,
      name,
      site,
      assessment,
    ],
    forbiddenIds: [
      email.id,
      phone.id,
      person.id,
      name.id,
      site.id,
      assessment.id,
      address.id,
      addressCandidate.id,
    ],
    forbiddenText: [
      "reception@brightsmile-clinic.example",
      "(555) 123-4567",
      "Jane Roe",
      "brightsmile-clinic.example",
      "facebook.com",
      "12 Main Street",
      "Flat 4",
    ],
  };
}

function restaurant(): IndustryFixture {
  const f = makeBuilder(2);
  const email = f.fact("contact_email", "bookings@trattoria-luna.example");
  const phone = f.fact("contact_phone", "+44 20 7946 0958");
  const person = f.fact("person", "Marco Bianchi, Head Chef");
  const assessment = f.assessment("opportunity", "Could use online ordering.");
  const address = f.fact("contact_address", "4 Via Roma, London EC1A 1BB");
  return {
    name: "restaurant",
    findings: [
      f.fact(
        "business_description",
        "Neighbourhood Italian restaurant with dine-in, takeaway and table reservations. Phone +44 20 7946 0958.",
      ),
      f.detail("industry", "Restaurant"),
      f.fact("service", "Dine-in"),
      f.fact("service", "Takeaway"),
      f.fact("service", "Table reservations"),
      f.candidate("service", "Catering enquiries"),
      f.detail("product", "Wood-fired pizza"),
      f.detail("product", "Fresh pasta"),
      f.fact("location", "London, UK"),
      f.social("instagram", "https://instagram.com/trattoria.luna"),
      email,
      phone,
      person,
      assessment,
      address,
    ],
    forbiddenIds: [email.id, phone.id, person.id, assessment.id, address.id],
    forbiddenText: [
      "bookings@trattoria-luna.example",
      "+44 20 7946 0958",
      "Marco Bianchi",
      "4 Via Roma",
    ],
  };
}

function hotel(): IndustryFixture {
  const f = makeBuilder(3);
  const email = f.fact("contact_email", "stay@harbourview-hotel.example");
  const phone = f.fact("contact_phone", "+971 4 555 0100");
  const address = f.candidate("contact_address", "Marina Walk, Building 7, Dubai");
  return {
    name: "hotel",
    findings: [
      f.fact(
        "business_description",
        "Boutique hotel with 40 rooms near the marina. Guests can book rooms, arrange airport pickup and host small events.",
      ),
      f.detail("industry", "Hotel"),
      f.fact("service", "Room bookings"),
      f.fact("service", "Airport pickup"),
      f.fact("service", "Event hosting"),
      f.candidate("service", "Guest concierge"),
      f.fact("location", "Dubai, UAE"),
      f.fact("service_area", "Dubai Marina"),
      f.social("tripadvisor", "https://tripadvisor.com/Hotel_Review-harbourview"),
      email,
      phone,
      address,
    ],
    forbiddenIds: [email.id, phone.id, address.id],
    forbiddenText: [
      "stay@harbourview-hotel.example",
      "+971 4 555 0100",
      "tripadvisor.com",
      "Building 7",
    ],
  };
}

function realEstate(): IndustryFixture {
  const f = makeBuilder(4);
  const email = f.fact("contact_email", "agents@cityhomes-realty.example");
  const person = f.fact("person", "Sam Lee, Senior Agent");
  const address = f.fact("contact_address", "Plot 12, Gulberg III, Lahore");
  return {
    name: "real estate",
    findings: [
      f.fact(
        "business_description",
        "Residential real estate agency for sales, rentals and property viewings. Enquire at 0300 123 4567.",
      ),
      f.detail("industry", "Real estate agency"),
      f.fact("service", "Property viewings"),
      f.fact("service", "Rental management"),
      f.fact("service", "Property valuations"),
      f.candidate("service", "Lead generation for landlords"),
      f.fact("location", "Lahore, Pakistan"),
      f.fact("service_area", "DHA and Gulberg"),
      f.social("linkedin", "https://linkedin.com/company/cityhomes"),
      email,
      person,
      address,
    ],
    forbiddenIds: [email.id, person.id, address.id],
    forbiddenText: [
      "agents@cityhomes-realty.example",
      "Sam Lee",
      "0300 123 4567",
      "linkedin.com",
      "Plot 12",
    ],
  };
}

function ecommerce(): IndustryFixture {
  const f = makeBuilder(5);
  const email = f.fact("contact_email", "support@emberandwick.example");
  const address = f.candidate("contact_address", "88 Maple Lane, Portland OR 97201");
  return {
    name: "e-commerce",
    findings: [
      f.fact(
        "business_description",
        "Online store selling handmade soy candles with free shipping and easy returns. Questions? Visit www.emberandwick.example/faq.",
      ),
      f.detail("industry", "E-commerce"),
      f.detail("product", "Soy candles"),
      f.detail("product", "Gift sets"),
      f.fact("service", "Order tracking"),
      f.fact("service", "Free shipping"),
      f.fact("service", "Returns policy"),
      f.candidate("service", "Customer support FAQ"),
      f.fact("location", "Portland, OR"),
      f.social("instagram", "https://instagram.com/emberandwick"),
      email,
      address,
    ],
    forbiddenIds: [email.id, address.id],
    forbiddenText: [
      "support@emberandwick.example",
      "www.emberandwick.example",
      "instagram.com",
      "88 Maple Lane",
    ],
  };
}

function marketingAgency(): IndustryFixture {
  const f = makeBuilder(6);
  const email = f.fact("contact_email", "hello@northlight-media.example");
  const phone = f.fact("contact_phone", "555.987.6543");
  const person = f.fact("person", "Priya Nair, Founder");
  const address = f.fact("contact_address", "Unit 3, 45 Queen Street West, Toronto");
  return {
    name: "marketing agency",
    findings: [
      f.fact(
        "business_description",
        "Digital marketing agency running campaigns for local businesses. Reach us at 555.987.6543.",
      ),
      f.detail("industry", "Marketing agency"),
      f.fact("service", "SEO"),
      f.fact("service", "Social media management"),
      f.fact("service", "Lead generation campaigns"),
      f.candidate("service", "Client reporting dashboards"),
      f.fact("location", "Toronto, ON"),
      f.social("linkedin", "https://linkedin.com/company/northlight-media"),
      email,
      phone,
      person,
      address,
    ],
    forbiddenIds: [email.id, phone.id, person.id, address.id],
    forbiddenText: ["hello@northlight-media.example", "555.987.6543", "Priya Nair", "Queen Street"],
  };
}

export function industryFixtures(): IndustryFixture[] {
  return [clinic(), restaurant(), hotel(), realEstate(), ecommerce(), marketingAgency()];
}

/** A minimal, valid fixture for focused tests. */
export function smallPack() {
  const f = makeBuilder(9);
  const findings = [
    f.fact("service", "Emergency repairs"),
    f.fact("service", "Annual maintenance"),
    f.candidate("service", "Commercial contracts"),
    f.fact("business_description", "Local repair company."),
    f.fact("location", "Leeds, UK"),
  ];
  return { findings, f };
}
