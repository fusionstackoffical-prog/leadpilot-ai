import { Skeleton } from "@/components/ui/states";

export default function ResearchLoading() {
  return (
    <div
      className="mx-auto max-w-[1600px] space-y-5"
      aria-busy="true"
      aria-label="Loading companies"
    >
      <Skeleton className="h-9 rounded-md" />
      <Skeleton className="h-[480px] rounded-card" />
    </div>
  );
}
