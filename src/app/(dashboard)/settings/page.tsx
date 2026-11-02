import { CheckCircle2, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { StatRow } from "@/components/data/stat-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireWorkspaceContext } from "@/features/workspace/queries";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnvIssues } from "@/lib/env/server";

export const metadata: Metadata = { title: "Settings" };

/** Read-only in Phase 0. Reports whether integrations are configured — never secret values. */
export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspaceContext();

  const integrations = [
    {
      name: "Supabase database & auth",
      configured: Boolean(getPublicEnv()) && getServerEnvIssues().length === 0,
      note: "Required",
    },
    { name: "AI provider (Claude)", configured: false, note: "Phase 4" },
    { name: "Email sending provider", configured: false, note: "Manual logging for MVP" },
    { name: "Email verification provider", configured: false, note: "Not selected" },
    { name: "n8n automation", configured: false, note: "Phase 6" },
  ];

  return (
    <div className="mx-auto grid max-w-[1200px] gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Workspace" />
        <CardBody>
          <dl className="divide-y divide-line">
            <StatRow label="Name" value={workspace.name} />
            <StatRow label="Business timezone" value={workspace.timezone} />
            <StatRow
              label="Your role"
              value={<span className="capitalize">{workspace.role}</span>}
            />
            <StatRow label="Signed in as" value={user.email} />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Connected providers"
          description="Configuration status only. Secret keys are never displayed."
        />
        <CardBody>
          <ul className="divide-y divide-line">
            {integrations.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{item.name}</span>
                  <span className="text-[11px] text-fg-muted">{item.note}</span>
                </span>
                {item.configured ? (
                  <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>
                    Configured
                  </Badge>
                ) : (
                  <Badge icon={<CircleDashed className="size-3" aria-hidden />}>
                    Not configured
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
