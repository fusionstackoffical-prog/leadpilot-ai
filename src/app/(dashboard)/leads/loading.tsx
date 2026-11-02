import { Skeleton } from "@/components/ui/states";

export default function LeadsLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading leads">
      <Skeleton className="h-[480px] rounded-card" />
    </div>
  );
}
