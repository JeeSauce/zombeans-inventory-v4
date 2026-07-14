import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
export default function CalendarLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-56" />
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-80 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
