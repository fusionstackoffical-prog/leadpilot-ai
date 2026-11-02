import { Skeleton } from "@/components/ui/states";

export default function ImportsLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading imports">
      <Skeleton className="h-[300px] rounded-card" />
      <Skeleton className="h-[260px] rounded-card" />
    </div>
  );
}
