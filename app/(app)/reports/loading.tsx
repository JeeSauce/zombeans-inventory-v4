import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading reports">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-48" key={index} />
        ))}
      </div>
    </main>
  );
}
