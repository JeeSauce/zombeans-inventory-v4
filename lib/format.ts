import { formatInTimeZone } from "date-fns-tz";

/** App-wide localization helpers. Timezone: Asia/Manila. Currency: PHP. */

const TZ = "Asia/Manila";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

/** ₱1,234.56 */
export function formatPeso(amount: number): string {
  return peso.format(amount);
}

/** MM/DD/YYYY — used in forms. */
export function formatFormDate(date: Date | string): string {
  return formatInTimeZone(new Date(date), TZ, "MM/dd/yyyy");
}

/** Month D, YYYY — human-readable summaries. */
export function formatHumanDate(date: Date | string): string {
  return formatInTimeZone(new Date(date), TZ, "MMMM d, yyyy");
}

/** Month D, YYYY h:mm a — human-readable timestamps in Manila time. */
export function formatHumanDateTime(date: Date | string): string {
  return formatInTimeZone(new Date(date), TZ, "MMMM d, yyyy h:mm a");
}
