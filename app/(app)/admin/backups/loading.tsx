import { Skeleton } from "@/components/ui/skeleton";

export default function BackupsLoading() {
  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading backups">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-44" key={index} />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
