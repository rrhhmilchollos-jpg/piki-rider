import { describe, expect, it, vi } from "vitest";
import { arrivalAcknowledgedFix, RiderArrivalAlerts, riderArrivalKey, riderArrivalKnownMinimumRadiusMeters } from "./riderArrivalAlerts";
import type { RiderOffer } from "./types/rider";
import type { RiderGpsSnapshot } from "./riderGpsTracker";
const start = 1_000_000;
// Synthetic test fixtures only; never published to any API.
const order: RiderOffer = { _id: "fixture-order", assignmentState: "assigned", status: "preparing",
  restaurant: { location: { type: "Point", coordinates: [0, 0] } },
  deliveryLocation: { type: "Point", coordinates: [1, 1] } };
const waiting: RiderGpsSnapshot = { state: "waiting", detail: "fixture" };
function ack(timestamp: number, latitude = 0, longitude = 0, accuracy = 5): RiderGpsSnapshot {
  return { state: "tracking", detail: "fixture", lastFixAt: timestamp, lastAckAt: timestamp + 1,
    lastAcknowledgedFix: { latitude, longitude, accuracy, timestamp } };
}
function fixture(consumed = new Set<string>()) {
  const notify = vi.fn(); const retain = vi.fn();
  const controller = new RiderArrivalAlerts({ consumed: (key) => consumed.has(key),
    consume: (key) => { if (consumed.has(key)) return false; consumed.add(key); return true; }, notify, retain });
  const bind = (next: RiderOffer = order, enabled = true, consent = true, now = start, gps = waiting, riderId = "fixture-rider") =>
    controller.setContext({ riderId, order: next, enabled, consent }, gps, now);
  const observe = (gps: RiderGpsSnapshot, now = (gps.lastAckAt ?? start) + 1) => controller.observe(gps, now);
  return { controller, notify, retain, bind, observe, consumed };
}
describe("Rider arrival signals — local fixtures, not E2E", () => {
  it("reuses only the server's known radius lower bound, never assumes its live override", () => {
    expect(riderArrivalKnownMinimumRadiusMeters).toBe(30);
  });
  it("emits arrived_store exactly once on an acknowledged outside-to-inside entry", () => {
    const f = fixture(); f.bind();
    f.observe(ack(start + 10, 0.001));
    f.observe(ack(start + 20));
    f.observe(ack(start + 30, 0.001)); f.observe(ack(start + 40));
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0].slice(0, 2)).toEqual(["arrived_store", riderArrivalKey("fixture-rider", order._id, "arrived_store")]);
  });
  it.each(["picked_up", "on_the_way"] as const)("uses the customer target only in delivery phase %s", (status) => {
    const f = fixture(); f.bind({ ...order, status });
    f.observe(ack(start + 10, 0, 0)); // At the commerce, far from this customer.
    expect(f.notify).not.toHaveBeenCalled();
    f.observe(ack(start + 20, 1, 1));
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0][0]).toBe("arrived_customer");
  });
  it("has independent phases for the same order and retires the store notification at phase change", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    const storeGuard = f.notify.mock.calls[0][2] as () => boolean;
    f.bind({ ...order, status: "on_the_way" }, true, true, start + 30);
    expect(storeGuard()).toBe(false);
    expect(f.retain).toHaveBeenLastCalledWith([]);
    f.observe(ack(start + 40)); f.observe(ack(start + 50, 1, 1));
    expect(f.notify.mock.calls.map(([kind]) => kind)).toEqual(["arrived_store", "arrived_customer"]);
  });
  it("never interprets initial nearby hydration as an arrival or replays on remount/reconnect", () => {
    const persisted = new Set<string>(); const first = fixture(persisted);
    first.bind(); first.observe(ack(start + 10));
    first.observe(ack(start + 20, 0.001)); first.observe(ack(start + 30));
    expect(first.notify).not.toHaveBeenCalled();
    const remount = fixture(persisted); remount.bind();
    remount.observe(ack(start + 40, 0.001)); remount.observe(ack(start + 50));
    expect(remount.notify).not.toHaveBeenCalled();
  });
  it("persists one-phase dedupe across reset/login while clearing active state", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    f.controller.reset(); f.observe(ack(start + 30));
    expect(f.retain).toHaveBeenLastCalledWith([]);
    f.bind(); f.observe(ack(start + 40, 0.001)); f.observe(ack(start + 50));
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect([...f.consumed]).toEqual([riderArrivalKey("fixture-rider", order._id, "arrived_store")]);
  });
  it("does not announce a crossing inferred across network/GPS recovery", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001));
    f.observe({ state: "error", detail: "offline" });
    f.observe(ack(start + 20));
    expect(f.notify).not.toHaveBeenCalled();
  });
  it("requires the correlated operational ACK, not an unacknowledged newer map timestamp", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001));
    f.observe({ ...ack(start + 10, 0.001), lastFixAt: start + 20 });
    f.observe({ state: "tracking", detail: "fixture", lastFixAt: start + 30, lastAckAt: start + 31 });
    expect(f.notify).not.toHaveBeenCalled();
    f.observe(ack(start + 40)); expect(f.notify).toHaveBeenCalledTimes(1);
  });
  it("rejects cached, future, missing, invalid and inaccurate GPS/ACK evidence", () => {
    const base = ack(start + 10);
    const bad: RiderGpsSnapshot[] = [
      { ...base, lastAckAt: undefined }, { ...base, lastAckAt: NaN }, { ...base, lastAckAt: start - 1 },
      { ...base, lastAckAt: start + 1000 }, { ...base, lastAcknowledgedFix: undefined },
      ...[NaN, start - 20_000, start + 1000].map((timestamp) => ({ ...base, lastAcknowledgedFix: { ...base.lastAcknowledgedFix!, timestamp } })),
      ...[-1, NaN, 151].map((accuracy) => ack(start + 10, 0, 0, accuracy)),
      ack(start + 10, 91), ack(start + 10, 0, 181), { ...base, state: "starting" as const },
    ];
    for (const gps of bad) expect(arrivalAcknowledgedFix(gps, start + 100)).toBeNull();
    expect(arrivalAcknowledgedFix(base, start + 100)).toEqual(base.lastAcknowledgedFix);
  });
  it("does not treat a stale late ACK as a fresh location or use a pre-assignment fix", () => {
    const f = fixture(); f.bind(); f.observe(ack(start - 10, 0.001)); f.observe(ack(start - 5));
    const slow = { ...ack(start + 10), lastAckAt: start + 20_000 };
    f.observe(slow, start + 20_001);
    expect(f.notify).not.toHaveBeenCalled();
  });
  it("ignores uncertain reported precision rather than inventing a more precise fix", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001));
    f.observe(ack(start + 20, 0, 0, 150));
    expect(f.notify).not.toHaveBeenCalled();
    f.observe(ack(start + 30, 0, 0, 5)); expect(f.notify).toHaveBeenCalledTimes(1);
  });
  it.each([null, { type: "Polygon", coordinates: [0, 0] }, { type: "Point", coordinates: [] },
    { type: "Point", coordinates: [NaN, 0] }, { type: "Point", coordinates: [0, 100] }])("stays silent for absent or invalid real destination %j", (location) => {
    const f = fixture(); f.bind({ ...order, restaurant: { location } });
    f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    expect(f.notify).not.toHaveBeenCalled();
  });
  it.each([[false, true], [true, false]])("respects operational enablement %s and consent %s", (enabled, consent) => {
    const f = fixture(); f.bind(order, enabled, consent);
    f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20)); expect(f.notify).not.toHaveBeenCalled();
    f.bind(order, true, true, start + 30); f.observe(ack(start + 40));
    expect(f.notify).not.toHaveBeenCalled(); // Re-enable while inside is not a replay.
  });
  it("never announces unassigned offers or changes pickup/delivery status", () => {
    const f = fixture(); const offer = { ...order, assignmentState: "offered" as const };
    f.bind(offer); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    expect(f.notify).not.toHaveBeenCalled(); expect(offer.status).toBe("preparing");
  });
  it.each(["logout", "cancel", "order", "consent", "gps"])("invalidates a queued show on %s", (reason) => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    const isCurrent = f.notify.mock.calls[0][2] as () => boolean; expect(isCurrent()).toBe(true);
    if (reason === "logout") f.controller.reset();
    if (reason === "cancel") f.controller.cancel(order._id);
    if (reason === "order") f.bind({ ...order, _id: "other-fixture-order" });
    if (reason === "consent") f.bind(order, true, false);
    if (reason === "gps") f.observe({ state: "idle", detail: "stopped" });
    expect(isCurrent()).toBe(false); expect(f.retain).toHaveBeenLastCalledWith([]);
  });
  it("scopes dedupe by rider/order/phase without tokens, coordinates or times", () => {
    const key = riderArrivalKey("fixture-rider", order._id, "arrived_store");
    expect(key).not.toBe(riderArrivalKey("other-rider", order._id, "arrived_store"));
    expect(key).not.toBe(riderArrivalKey("fixture-rider", order._id, "arrived_customer"));
    expect(key).not.toContain(String(start));
  });
  it("fails closed if a consumed marker cannot be persisted", () => {
    const notify = vi.fn(); const consume = vi.fn(() => false);
    const c = new RiderArrivalAlerts({ consumed: () => false, consume, notify, retain: vi.fn() });
    c.setContext({ riderId: "fixture-rider", order, enabled: true, consent: true }, waiting, start);
    c.observe(ack(start + 10, 0.001), start + 12); c.observe(ack(start + 20), start + 22);
    expect(consume).toHaveBeenCalledTimes(1); expect(notify).not.toHaveBeenCalled();
  });
  it("accepts a fresh authoritative arrival ACK for the exact commerce order only once", () => {
    const f = fixture(); f.bind(); const gps = ack(start + 10, 0.001);
    const event = { orderId: order._id, riderId: "fixture-rider", arrivedAt: new Date(start + 12).toISOString() };
    f.controller.partnerArrival(event, gps, start + 20); f.controller.partnerArrival(event, gps, start + 21);
    expect(f.notify).toHaveBeenCalledTimes(1);
  });
  it("rejects replayed SSE, wrong rider/order, missing real server time and customer phase", () => {
    const f = fixture(); f.bind(); const gps = ack(start + 10, 0.001);
    const event = { orderId: order._id, riderId: "fixture-rider", arrivedAt: new Date(start + 12).toISOString() };
    for (const invalid of [{ ...event, orderId: "other" }, { ...event, riderId: "other" },
      { ...event, arrivedAt: undefined }, { ...event, arrivedAt: "invalid" },
      { ...event, arrivedAt: new Date(start - 1).toISOString() }, { ...event, arrivedAt: new Date(start + 1000).toISOString() }]) {
      f.controller.partnerArrival(invalid, gps, start + 20);
    }
    f.bind({ ...order, status: "on_the_way" }, true, true, start + 30);
    f.controller.partnerArrival(event, ack(start + 40), start + 50);
    expect(f.notify).not.toHaveBeenCalled();
  });
  it("does not replay an arrival stored in the initial snapshot", () => {
    const f = fixture(); f.bind({ ...order, riderArrivedAt: new Date(start - 100).toISOString() });
    f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    expect(f.notify).not.toHaveBeenCalled();
  });
  it("detects a new authoritative arrival in later offers snapshots with fresh native ACK", () => {
    const f = fixture(); f.bind();
    const arrived = { ...order, riderArrivedAt: new Date(start + 12).toISOString() };
    f.bind(arrived, true, true, start + 20, ack(start + 10, 0.001));
    f.bind(arrived, true, true, start + 21, ack(start + 10, 0.001));
    expect(f.notify).toHaveBeenCalledTimes(1); expect(arrived.status).toBe("preparing");
  });
  it("invalidates a queued show synchronously when the authoritative snapshot removes or changes its order", () => {
    for (const next of [null, { ...order, _id: "other" }, { ...order, status: "on_the_way" as const }]) {
      const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
      const isCurrent = f.notify.mock.calls[0][2] as () => boolean;
      f.controller.retainOrder(next); expect(isCurrent()).toBe(false);
      expect(f.retain).toHaveBeenLastCalledWith([]);
    }
  });
  it("ties notification expiry to real provider time, not a fresh invented arrival timestamp", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001)); f.observe(ack(start + 20));
    expect(Date.parse(f.notify.mock.calls[0][3] as string)).toBe(start + 20 + 15_000);
  });
  it("silently consumes a later historical arrival snapshot without a recent operational fix", () => {
    const f = fixture(); f.bind(); f.observe(ack(start + 10, 0.001));
    f.bind({ ...order, riderArrivedAt: new Date(start - 100).toISOString() }, true, true, start + 20, waiting);
    f.observe(ack(start + 30)); expect(f.notify).not.toHaveBeenCalled();
  });
});
