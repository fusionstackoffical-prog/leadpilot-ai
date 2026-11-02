// Regenerates src/types/database.ts from the linked Supabase project's schema.
// Writes the file only after the generator succeeds, so a failure never empties it.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = "src/types/database.ts";
// Fixed command with no interpolated input (npx needs a shell on Windows).
const COMMAND = "npx --yes supabase gen types typescript --linked --schema public";

let types;
try {
  types = execSync(COMMAND, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
} catch {
  console.error(`Type generation failed; ${OUT} was left unchanged.`);
  process.exit(1);
}

if (!types.includes("export type Database")) {
  console.error(`Generator output did not contain the Database type; ${OUT} was left unchanged.`);
  process.exit(1);
}

writeFileSync(OUT, types);
console.log(`Wrote ${OUT}`);
