/**
 * The fixed opportunity categories. They are the values of migration 010's check constraint on
 * lead_opportunities.category: adding one needs a reviewed migration, never a model decision.
 * tests/analysis/migration-contract.test.ts compares this list with the migration.
 */
export const OPPORTUNITY_CATEGORIES = [
  "ai_receptionist",
  "ai_voice_agent",
  "support_chatbot",
  "business_process_automation",
  "custom_automation",
  "crm",
] as const;

export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export type CatalogueEntry = {
  /** Short name for people and for the prompt. */
  label: string;
  /** One-line definition given to the model. */
  definition: string;
};

export const OPPORTUNITY_CATALOGUE: Readonly<Record<OpportunityCategory, CatalogueEntry>> = {
  ai_receptionist: {
    label: "AI receptionist",
    definition:
      "Answers incoming calls and messages, covers after-hours, takes messages and routes enquiries.",
  },
  ai_voice_agent: {
    label: "AI voice agent",
    definition:
      "An AI phone agent for specific call tasks such as outbound reminders, lead qualification and follow-up calls.",
  },
  support_chatbot: {
    label: "Support chatbot",
    definition: "A website or chat assistant that answers FAQs and support questions.",
  },
  business_process_automation: {
    label: "Business process automation",
    definition:
      "Automating standard, repeatable workflows such as booking, reminders, follow-ups, lead intake and notifications.",
  },
  custom_automation: {
    label: "Custom automation",
    definition:
      "A bespoke automation or integration for a process that is unique to this business.",
  },
  crm: {
    label: "CRM",
    definition:
      "Setting up or integrating a CRM, or CRM-related automation for managing leads and customers.",
  },
};

/** migration 010: lead_opportunities.fit_level. */
export const FIT_LEVELS = ["strong", "moderate", "weak", "insufficient_evidence"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

export function isOpportunityCategory(value: unknown): value is OpportunityCategory {
  return typeof value === "string" && (OPPORTUNITY_CATEGORIES as readonly string[]).includes(value);
}
