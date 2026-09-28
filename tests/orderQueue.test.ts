import { describe, expect, it } from "vitest";
import { orderRiderQueue } from "../src/orderQueue";

describe("rider order queue", () => {
  it("puts the oldest requested order first", () => {
    const result = orderRiderQueue([
      { _id: "new", requestedAt: "2026-09-28T10:05:00.000Z" },
      { _id: "old", requestedAt: "2026-09-28T10:00:00.000Z" },
    ]);
    expect(result.map((order) => order._id)).toEqual(["old", "new"]);
  });

  it("keeps API order when timestamps are unavailable", () => {
    const result = orderRiderQueue([{ _id: "first" }, { _id: "second" }]);
    expect(result.map((order) => order._id)).toEqual(["first", "second"]);
  });

  it("uses the API order to break equal timestamps", () => {
    const result = orderRiderQueue([
      { _id: "first", createdAt: "2026-09-28T10:00:00.000Z" },
      { _id: "second", createdAt: "2026-09-28T10:00:00.000Z" },
    ]);
    expect(result.map((order) => order._id)).toEqual(["first", "second"]);
  });
});
