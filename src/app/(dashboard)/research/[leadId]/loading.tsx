import { Skeleton } from "@/components/ui/states";

export default function CompanyProfileLoading() {
  return (
    <div
      className="mx-auto max-w-[1600px] space-y-5"
      aria-busy="true"
      aria-label="Loading company profile"
    >
      <Skeleton className="h-8 w-36 rounded-md" />
      <Skeleton className="h-24 rounded-card" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
