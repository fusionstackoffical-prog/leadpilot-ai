import type { LucideIcon } from "lucide-react";
import { Microscope } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** What kind of information a value or section holds (docs/COMPANY_RESEARCH_SPEC.md §3). */
export type Provenance = "imported" | "confirmed" | "ai";

const PROVENANCE: Record<Provenance, { label: string; tone: "neutral" | "success" | "info" }> = {
  imported: { label: "Imported · unverified", tone: "neutral" },
  // Describes what the section accepts, so it stays neutral: it must never read as if the
  // values currently shown (e.g. an imported website) were confirmed.
  confirmed: { label: "Source-backed facts only", tone: "neutral" },
  ai: { label: "AI assessment · not fact", tone: "info" },
};

export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  return <Badge tone={PROVENANCE[kind].tone}>{PROVENANCE[kind].label}</Badge>;
}

export function Section({
  title,
  description,
  icon: Icon,
  kind,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  kind?: Provenance;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={title}
        description={description}
        icon={<Icon className="size-4" aria-hidden />}
        actions={kind ? <ProvenanceBadge kind={kind} /> : undefined}
      />
      <CardBody className="flex-1">{children}</CardBody>
    </Card>
  );
}

export function NotResearched({ what }: { what: string }) {
  return (
    <EmptyState
      compact
      icon={Microscope}
      title="Not researched yet"
      description={`${what} will appear here after this company is researched. Nothing has been looked up or inferred.`}
    />
  );
}
