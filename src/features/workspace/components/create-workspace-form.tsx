"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select } from "@/components/ui/form";
import { createWorkspace, type CreateWorkspaceState } from "@/features/workspace/actions";

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

const initial: CreateWorkspaceState = { status: "idle" };

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, initial);

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          maxLength={80}
          required
          placeholder="e.g. Acme Growth"
          defaultValue={state.name}
        />
      </div>
      <div>
        <Label htmlFor="timezone">Business timezone</Label>
        {/* key re-mounts the select so a returned value becomes its default after form reset */}
        <Select
          key={state.timezone}
          id="timezone"
          name="timezone"
          defaultValue={state.timezone || "America/New_York"}
        >
          {US_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-fg-muted">
          Used for &ldquo;today&rdquo; boundaries in metrics. You can change it later.
        </p>
      </div>
      {state.status === "error" && state.message ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <Button type="submit" variant="primary" className="w-full justify-center" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
