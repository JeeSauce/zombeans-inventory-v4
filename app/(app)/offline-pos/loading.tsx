import { Skeleton } from "@/components/ui/skeleton";

export default function OfflinePosLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-label="Loading offline and POS workspace">
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      {[1, 2, 3].map((value) => (
        <Skeleton key={value} className="h-72 w-full rounded-xl" />
      ))}
    </div>
  );
}
