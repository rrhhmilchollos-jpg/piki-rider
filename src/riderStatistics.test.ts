import { describe, expect, it } from "vitest";
import { mergeRiderStatistics } from "./riderStatistics";
const previous = { completed: 4, accepted: 5, cancelled: 1, rating: "4.8", distance: "8 km", dailyDeliveries: [{ date: "2026-11-11", completed: 4 }] };
describe("API rider metrics", () => {
  it("preserves absent metrics rather than inventing replacements", () => { expect(mergeRiderStatistics(previous, { completed: 7 })).toEqual({ ...previous, completed: 7 }); });
  it("handles null dailyDeliveries without crashing the panel", () => { expect(mergeRiderStatistics(previous, { dailyDeliveries: null }).dailyDeliveries).toEqual([]); });
  it("filters malformed days and rejects negative/non-finite counts", () => {
    expect(mergeRiderStatistics(previous, { completed: -1, accepted: NaN, cancelled: "8", dailyDeliveries: [null, {}, { date: "2026-11-11", completed: 4 }] })).toEqual(previous);
  });
});
