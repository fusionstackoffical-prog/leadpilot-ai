import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyProfile } from "@/features/research/components/company-profile";
import { getCompanyProfile } from "@/features/research/queries";
import { requireWorkspaceContext } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Company profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompanyProfilePage({ params }: PageProps<"/research/[leadId]">) {
  const { workspace } = await requireWorkspaceContext();
  const { leadId } = await params;
  if (!UUID.test(leadId)) notFound();

  // RLS returns nothing for leads outside the caller's workspace, so this is a 404.
  const profile = await getCompanyProfile(workspace.id, leadId);
  if (!profile) notFound();

  return <CompanyProfile {...profile} timezone={workspace.timezone} />;
}
