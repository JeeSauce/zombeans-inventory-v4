import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const BUSINESS_TIME_ZONE = "Asia/Manila";

export function manilaLocalToUtc(localDateTime: string): string {
  return fromZonedTime(localDateTime, BUSINESS_TIME_ZONE).toISOString();
}

export function utcToManilaLocal(date: Date | string): string {
  return formatInTimeZone(new Date(date), BUSINESS_TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
}
