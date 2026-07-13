import { Skeleton } from "@/components/ui/skeleton";

export default function ProductionLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-label="Loading production">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
