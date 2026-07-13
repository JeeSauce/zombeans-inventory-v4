import { Skeleton } from "@/components/ui/skeleton";

export default function CostingLoading() {
  return (
    <div className="mx-auto max-w-[90rem] space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
