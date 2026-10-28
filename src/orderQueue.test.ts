import { describe, expect, it } from "vitest";
import { orderRiderQueue, type QueueOrder } from "./orderQueue";

describe("orderRiderQueue", () => {
  it("orders all timestamped orders oldest first and keeps stable ties", () => {
    const orders: QueueOrder[] = [
      { _id: "later", requestedAt: "2026-10-28T12:00:00Z" },
      { _id: "first-tie", requestedAt: "2026-10-28T11:00:00Z" },
      { _id: "second-tie", requestedAt: "2026-10-28T11:00:00Z" },
    ];

    expect(orderRiderQueue(orders).map(({ _id }) => _id)).toEqual([
      "first-tie",
      "second-tie",
      "later",
    ]);
  });

  it("preserves API priority order when any order lacks a valid timestamp", () => {
    const orders: QueueOrder[] = [
      { _id: "later", requestedAt: "2026-10-28T12:00:00Z" },
      { _id: "unknown" },
      { _id: "earlier", requestedAt: "2026-10-28T10:00:00Z" },
    ];

    expect(orderRiderQueue(orders).map(({ _id }) => _id)).toEqual([
      "later",
      "unknown",
      "earlier",
    ]);
  });

  it("treats invalid timestamps as missing instead of comparing them as dates", () => {
    const orders: QueueOrder[] = [
      { _id: "invalid", requestedAt: "not-a-date" },
      { _id: "dated", requestedAt: "2026-10-28T10:00:00Z" },
    ];

    expect(orderRiderQueue(orders).map(({ _id }) => _id)).toEqual(["invalid", "dated"]);
  });
});
