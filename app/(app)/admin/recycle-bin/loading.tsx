import { Skeleton } from "@/components/ui/skeleton";

export default function RecycleBinLoading() {
  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading recycle bin">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
