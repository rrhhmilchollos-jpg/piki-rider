export type RiderStatistics = {
  completed: number; cancelled: number; accepted: number; rating: string; distance: string;
  dailyDeliveries: Array<{ date: string; completed: number }>;
};
const count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
/** Keep API values; malformed optional metrics cannot crash the existing panel. */
export function mergeRiderStatistics(previous: RiderStatistics, input: unknown): RiderStatistics {
  if (!input || typeof input !== "object" || Array.isArray(input)) return previous;
  const data = input as Record<string, unknown>;
  const next = { ...previous };
  for (const key of ["completed", "cancelled", "accepted"] as const) if (count(data[key])) next[key] = data[key];
  for (const key of ["rating", "distance"] as const) if (typeof data[key] === "string") next[key] = data[key];
  if ("dailyDeliveries" in data) next.dailyDeliveries = Array.isArray(data.dailyDeliveries)
    ? data.dailyDeliveries.filter((day): day is { date: string; completed: number } => Boolean(day)
      && typeof day === "object" && typeof day.date === "string" && count(day.completed)) : [];
  return next;
}
