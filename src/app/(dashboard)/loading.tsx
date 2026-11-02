import { Skeleton } from "@/components/ui/states";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-80" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-[136px] rounded-card" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Skeleton className="h-[340px] rounded-card" />
        <Skeleton className="h-[340px] rounded-card" />
      </div>
    </div>
  );
}
