import { Skeleton } from "@/components/ui/skeleton";

export default function ReportDetailLoading() {
  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading report">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-24" key={index} />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </main>
  );
}
