import "server-only";
import { evaluateResearchSetup, type ResearchSetup } from "./setup-core.ts";

export type { ResearchSetup };

/**
 * Whether research is configured on this server. Server-only: it reads the server's environment,
 * and returns only a yes/no and the names of what is missing, never any value.
 */
export function getResearchSetup(): ResearchSetup {
  return evaluateResearchSetup(process.env);
}
