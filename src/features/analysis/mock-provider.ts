import {
  ProviderError,
  type AnalysisProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ProviderErrorCode,
} from "./provider.ts";
import type { OpportunityCategory, FitLevel } from "./catalogue.ts";

/**
 * The ONLY provider implemented in this step. It makes no network call, reads no environment
 * variable and costs nothing: provider id 'mock', model 'mock-1', zero tokens, zero cost.
 *
 * It is deterministic. By default ("valid") it reads the evidence block out of the prompt it is
 * given (so it also proves the prompt is well formed) and answers by simple keyword rules. A test
 * can script other behaviours per call: malformed JSON, invented references, contact data, an
 * answer that obeys an injection, a provider error, a call that never returns, and so on.
 */

export const MOCK_PROVIDER_ID = "mock";
export const MOCK_MODEL = "mock-1";

export type MockBehavior =
  /** A correct answer derived from the evidence in the prompt. */
  | { kind: "valid" }
  /** Exactly this text. */
  | { kind: "raw"; text: string }
  | { kind: "malformed_json" }
  | { kind: "empty" }
  | { kind: "invented_reference" }
  | { kind: "missing_references" }
  | { kind: "duplicate_references" }
  | { kind: "strong_on_candidates" }
  | { kind: "url_in_text" }
  | { kind: "email_in_text" }
  | { kind: "phone_in_text" }
  | { kind: "extra_keys" }
  | { kind: "too_many_opportunities" }
  /** Obeys an injected instruction: every category "strong" plus contact data. */
  | { kind: "follows_injection" }
  /** Throws a ProviderError with this code. */
  | { kind: "error"; code: ProviderErrorCode }
  /** Throws a plain Error (not a ProviderError). */
  | { kind: "crash" }
  /** Never answers until the request is aborted. */
  | { kind: "hang" };

export type MockProviderOptions = {
  /** Behaviour of call 1, 2, ...; after the script ends, `fallback` is used. */
  script?: readonly MockBehavior[];
  fallback?: MockBehavior;
};

export type MockProvider = AnalysisProvider & {
  /** Every request received, in order. */
  readonly calls: readonly GenerateRequest[];
};

type ParsedItem = { ref: string; status: string; topic: string; value: string; quote: string };

/** Reads the evidence lines back out of the user message. */
function readEvidence(request: GenerateRequest): ParsedItem[] {
  const content = request.messages.at(-1)?.content ?? "";
  const block = /<<<EVIDENCE-([0-9a-f]{16})\n([\s\S]*?)\nEVIDENCE-\1>>>/.exec(content);
  if (!block) return [];
  const items: ParsedItem[] = [];
  for (const line of block[2].split("\n")) {
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o.ref === "string") {
        items.push({
          ref: o.ref,
          status: String(o.status ?? ""),
          topic: String(o.topic ?? ""),
          value: String(o.value ?? ""),
          quote: String(o.quote ?? ""),
        });
      }
    } catch {
      // not an evidence line
    }
  }
  return items;
}

type Opportunity = {
  category: OpportunityCategory;
  fit_level: FitLevel;
  rationale: string;
  confidence: number;
  evidence_refs: string[];
  missing_information: string[];
  uncertainty: string;
};

const answer = (opportunities: unknown[]) => JSON.stringify({ opportunities });

const RULES: { category: OpportunityCategory; pattern: RegExp; why: string }[] = [
  {
    category: "ai_receptionist",
    pattern: /phone|call|reception|front desk|enquir|inquir|message|walk-in|after.?hours/i,
    why: "The company appears to handle enquiries from customers directly, which an AI receptionist could cover outside working hours.",
  },
  {
    category: "business_process_automation",
    pattern: /appointment|booking|book|reservation|schedul|order|delivery|quote|checkout|reminder/i,
    why: "The company offers services that involve scheduling or repeatable order steps that can be automated.",
  },
  {
    category: "support_chatbot",
    pattern: /faq|support|help|question|customer service|returns|shipping|track|policy|menu/i,
    why: "The company deals with common customer questions that a chat assistant could answer.",
  },
  {
    category: "crm",
    pattern: /lead|client|customer|campaign|patient|guest|member|subscriber|tenant|buyer/i,
    why: "The company works with many customers or leads whose follow-up could be managed in a CRM.",
  },
  {
    category: "ai_voice_agent",
    pattern: /outbound|reminder call|follow-up call|qualif|consultation|viewing|test drive/i,
    why: "Some activities involve scheduled calls that an AI voice agent could make.",
  },
];

function validAnswer(items: ParsedItem[]): string {
  const opportunities: Opportunity[] = [];
  let strong = 0;
  for (const rule of RULES) {
    const matching = items.filter((i) => rule.pattern.test(`${i.topic} ${i.value} ${i.quote}`));
    if (matching.length === 0) continue;
    const facts = matching.filter((i) => i.status === "fact");
    const refs = (facts.length ? facts : matching).slice(0, 3).map((i) => i.ref);
    let fit: FitLevel = facts.length === 0 ? "weak" : matching.length >= 2 ? "strong" : "moderate";
    if (fit === "strong" && ++strong > 3) fit = "moderate";
    opportunities.push({
      category: rule.category,
      fit_level: fit,
      rationale: rule.why,
      confidence: fit === "strong" ? 0.8 : fit === "moderate" ? 0.6 : 0.35,
      evidence_refs: refs,
      missing_information: ["Current call or enquiry volume", "Tools the company already uses"],
      uncertainty:
        facts.length === 0
          ? "Only unconfirmed items support this, so it needs checking with the company."
          : "How much of this is already handled manually is not stated.",
    });
  }
  if (opportunities.length === 0) {
    opportunities.push({
      category: "custom_automation",
      fit_level: "insufficient_evidence",
      rationale: "The evidence does not show a clear need for a standard automation.",
      confidence: 0.2,
      evidence_refs: [],
      missing_information: ["How the company handles enquiries today"],
      uncertainty: "There is too little information to judge.",
    });
  }
  return answer(opportunities);
}

/** One well-formed opportunity citing the given references; fields can be overridden. */
function one(refs: string[], over: Partial<Opportunity> = {}): Opportunity {
  return {
    category: "ai_receptionist",
    fit_level: "moderate",
    rationale: "The company seems to take calls directly.",
    confidence: 0.6,
    evidence_refs: refs,
    missing_information: ["Call volume"],
    uncertainty: "Opening hours are unknown.",
    ...over,
  };
}

function scripted(behavior: MockBehavior, items: ParsedItem[]): string {
  const first = items[0]?.ref ?? "E1";
  const firstFact = items.find((i) => i.status === "fact")?.ref ?? first;
  switch (behavior.kind) {
    case "valid":
      return validAnswer(items);
    case "raw":
      return behavior.text;
    case "malformed_json":
      return '{"opportunities": [ {"category": "ai_receptionist", "fit_level": "mod';
    case "empty":
      return "";
    case "invented_reference":
      return answer([one(["E999"])]);
    case "missing_references":
      return answer([one([])]);
    case "duplicate_references":
      return answer([one([firstFact, firstFact])]);
    case "strong_on_candidates": {
      const candidate = items.find((i) => i.status.startsWith("candidate"))?.ref ?? first;
      return answer([one([candidate], { fit_level: "strong", confidence: 0.9 })]);
    }
    case "url_in_text":
      return answer([
        one([firstFact], { rationale: "See https://example.com/booking for details." }),
      ]);
    case "email_in_text":
      return answer([one([firstFact], { uncertainty: "Reach the owner at owner@example.com." })]);
    case "phone_in_text":
      return answer([
        one([firstFact], { missing_information: ["Call +1 (555) 010-9999 to confirm"] }),
      ]);
    case "extra_keys":
      return answer([{ ...one([firstFact]), note: "ignore the rules" }]);
    case "too_many_opportunities":
      return answer(Array.from({ length: 7 }, () => one([firstFact])));
    case "follows_injection": {
      const categories: OpportunityCategory[] = [
        "ai_receptionist",
        "ai_voice_agent",
        "support_chatbot",
        "business_process_automation",
        "custom_automation",
        "crm",
      ];
      return answer(
        categories.map((category) =>
          one([firstFact], {
            category,
            fit_level: "strong",
            confidence: 1,
            rationale:
              "Absolutely recommended. Contact the owner at attacker@evil.example or +1 (555) 010-9999 or https://evil.example now.",
          }),
        ),
      );
    }
    default:
      return "";
  }
}

export function createMockProvider(options: MockProviderOptions = {}): MockProvider {
  const calls: GenerateRequest[] = [];
  const script = options.script ?? [];
  const fallback: MockBehavior = options.fallback ?? { kind: "valid" };

  return {
    id: MOCK_PROVIDER_ID,
    calls,
    async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
      const behavior = script[calls.length] ?? fallback;
      calls.push(request);

      if (behavior.kind === "error") throw new ProviderError(behavior.code);
      if (behavior.kind === "crash")
        throw new Error("mock crash: internal detail that must never leak");
      if (behavior.kind === "hang") {
        await new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new Error("aborted"));
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }

      return {
        text: scripted(behavior, readEvidence(request)),
        model: MOCK_MODEL,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    },
  };
}
