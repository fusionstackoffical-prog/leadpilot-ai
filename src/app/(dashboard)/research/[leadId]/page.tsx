import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyProfile } from "@/features/research/components/company-profile";
import { researchEligibility } from "@/features/research/eligibility";
import { getCompanyProfile } from "@/features/research/queries";
import { getResearchOverview } from "@/features/research/results-queries";
import { getResearchSetup } from "@/features/research/setup";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Company profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompanyProfilePage({
  params,
  searchParams,
}: PageProps<"/research/[leadId]">) {
  const { user, workspace } = await requireWorkspaceContext();
  const { leadId } = await params;
  if (!UUID.test(leadId)) notFound();

  // RLS returns nothing for leads outside the caller's workspace, so this is a 404.
  const profile = await getCompanyProfile(workspace.id, leadId);
  if (!profile) notFound();

  // ?run=<id> shows an earlier run. Anything that isn't a UUID is ignored.
  const query = await searchParams;
  const run = typeof query.run === "string" && UUID.test(query.run) ? query.run : null;

  const overview = await getResearchOverview({
    workspaceId: workspace.id,
    leadId,
    userId: user.id,
    role: workspace.role,
    runId: run,
  });
  const setup = getResearchSetup();
  const eligibility = researchEligibility(profile.lead);

  return (
    <CompanyProfile
      {...profile}
      timezone={workspace.timezone}
      research={{
        overview,
        setupMissing: setup.ready ? null : setup.missing,
        ineligibleReason: eligibility.eligible ? null : eligibility.message,
        // One key per page render: a double click re-sends the same key, which the database
        // answers with "already received" instead of creating a second run.
        requestKey: crypto.randomUUID(),
      }}
    />
  );
}
