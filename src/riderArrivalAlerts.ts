import { isCustomerDeliveryPhase } from "./orderPaymentInstruction";
import {
  gpsDistanceMeters, riderGpsFixMaxAgeMs, riderOrderGpsMaxAccuracyMeters, validGpsPoint,
  type GpsFix, type GpsPoint,
} from "./riderGpsPolicy";
import type { RiderGpsSnapshot } from "./riderGpsTracker";
import type { RiderOffer } from "./types/rider";

export type RiderArrivalKind = "arrived_store" | "arrived_customer";
/**
 * API source: server.ts PICKUP_ARRIVAL_RADIUS_METERS and DELIVERY_CONFIRMATION_RADIUS_METERS
 * both enforce Math.max(30, configuredValue || 80). Rider does not receive the override.
 * Use only the existing 30 m lower bound, NOT an assumed live/default 80 m radius.
 * This conservative subset is a notification fence, never confirmation/coverage policy.
 */
export const riderArrivalKnownMinimumRadiusMeters = 30;
export const riderArrivalKey = (riderId: string, orderId: string, kind: RiderArrivalKind) =>
  `piki-rider-arrival:v1:${encodeURIComponent(riderId)}:${encodeURIComponent(orderId)}:${kind}`;

type Port = {
  /** Stores only the dedupe key, never GPS, provider/ACK times, tokens or customer data. */
  consumed: (key: string) => boolean;
  consume: (key: string) => boolean;
  notify: (kind: RiderArrivalKind, key: string, isCurrent: () => boolean, expiresAt: string) => void;
  retain: (keys: string[]) => void;
};
type Context = { riderId: string; order: RiderOffer | null; enabled: boolean; consent: boolean };
type Active = {
  signature: string;
  key: string;
  kind: RiderArrivalKind;
  riderId: string;
  orderId: string;
  target: GpsPoint;
  boundAt: number;
  lastFixAt: number;
  outside: boolean | null;
  arrivedAt: string | null;
  consumed: boolean;
};
function targetPoint(order: RiderOffer, kind: RiderArrivalKind): GpsPoint | null {
  const location = kind === "arrived_store" ? order.restaurant?.location : order.deliveryLocation;
  if (location?.type !== "Point" || !Array.isArray(location.coordinates) || location.coordinates.length < 2) return null;
  const [longitude, latitude] = location.coordinates;
  const point = { latitude, longitude, accuracy: 0 };
  return validGpsPoint(point) ? point : null;
}
function actualTime(value: unknown, now: number): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now ? time : null;
}
/** Reject stale/uncorrelated evidence: a newer map fix is not the fix that received the ACK. */
export function arrivalAcknowledgedFix(gps: RiderGpsSnapshot, now: number): GpsFix | null {
  const fix = gps.lastAcknowledgedFix;
  const ackAt = gps.lastAckAt;
  if (gps.state !== "tracking" || !fix || !validGpsPoint(fix) || fix.accuracy > riderOrderGpsMaxAccuracyMeters
    || !Number.isFinite(fix.timestamp) || fix.timestamp > now || now - fix.timestamp > riderGpsFixMaxAgeMs
    || typeof ackAt !== "number" || !Number.isFinite(ackAt) || ackAt < fix.timestamp || ackAt > now
    || now - ackAt > riderGpsFixMaxAgeMs) return null;
  return fix;
}

/** No location watcher, polling, network mutation or confirmation endpoint belongs to this controller. */
export class RiderArrivalAlerts {
  private active: Active | null = null;
  private revision = 0;
  private readonly port: Port;
  constructor(port: Port) { this.port = port; }

  reset() {
    ++this.revision; // Invalidates a permission check/show queued before logout/cancel/consent change.
    this.active = null;
    this.port.retain([]);
    // Retain consumed tombstones for idempotency across remount/login; no active GPS state survives.
  }
  cancel(orderId: string) {
    if (this.active?.orderId === orderId) this.reset();
  }
  /** Synchronous snapshot reconciliation: don't leave an old queued show valid until React effects run. */
  retainOrder(order: RiderOffer | null) {
    const active = this.active;
    if (!active) return;
    const kind = order && isCustomerDeliveryPhase(order.status) ? "arrived_customer" : "arrived_store";
    const target = order ? targetPoint(order, kind) : null;
    if (!order || order.assignmentState !== "assigned" || order._id !== active.orderId || kind !== active.kind
      || !target || target.latitude !== active.target.latitude || target.longitude !== active.target.longitude) this.reset();
  }
  setContext(context: Context, gps: RiderGpsSnapshot, now = Date.now()) {
    const { riderId, order, enabled, consent } = context;
    if (!enabled || !consent || !riderId.trim() || !order?._id.trim() || order.assignmentState !== "assigned") {
      if (this.active) this.reset();
      return;
    }
    if (!["pending", "accepted", "preparing", "ready_for_pickup", "picked_up", "on_the_way"].includes(order.status)) {
      if (this.active) this.reset();
      return;
    }
    const kind: RiderArrivalKind = isCustomerDeliveryPhase(order.status) ? "arrived_customer" : "arrived_store";
    const target = targetPoint(order, kind);
    if (!target) { if (this.active) this.reset(); return; }
    const key = riderArrivalKey(riderId, order._id, kind);
    const signature = `${key}:${target.latitude}:${target.longitude}`;
    const arrivedAt = kind === "arrived_store" && actualTime(order.riderArrivedAt, now) != null ? order.riderArrivedAt! : null;
    if (this.active?.signature !== signature) {
      this.reset();
      this.active = { signature, key, kind, riderId, orderId: order._id, target,
        boundAt: now, lastFixAt: -Infinity, outside: null, arrivedAt, consumed: this.port.consumed(key) };
      // Hydration of an already arrived order is history, not a new arrival event.
      if (arrivedAt) this.consume(false);
      return;
    }
    const previousArrival = this.active.arrivedAt;
    this.active.arrivedAt = arrivedAt;
    if (!previousArrival && arrivedAt) {
      this.partnerArrival({ orderId: order._id, riderId, arrivedAt }, gps, now);
      // A historical/missed arrival is consumed silently, not replayed after the next GPS recovery.
      if (!this.active.consumed) this.consume(false);
    }
  }

  observe(gps: RiderGpsSnapshot, now = Date.now()) {
    const active = this.active;
    if (!active) return;
    if (gps.state !== "tracking") {
      // A queued signal also loses validity when GPS stops/errors, even if already consumed.
      active.outside = null;
      ++this.revision;
      this.port.retain([]);
      return;
    }
    if (active.consumed) return;
    const fix = arrivalAcknowledgedFix(gps, now);
    if (!fix) return;
    if (fix.timestamp < active.boundAt || fix.timestamp <= active.lastFixAt) return;
    active.lastFixAt = fix.timestamp;
    const distance = gpsDistanceMeters(fix, active.target);
    // The reported accuracy is not a guaranteed error bound. An ambiguous estimate does not fire.
    const inside = distance + fix.accuracy <= riderArrivalKnownMinimumRadiusMeters;
    const outside = distance - fix.accuracy > riderArrivalKnownMinimumRadiusMeters;
    if (!inside && !outside) return;
    if (active.outside === null) {
      active.outside = outside;
      if (inside) this.consume(false); // Already nearby at mount/reconnect: no replay now or later.
      return;
    }
    if (inside && active.outside) this.consume(true, fix);
    else if (outside) active.outside = true;
  }

  /** Existing authoritative server arrival ACK may precede the offers snapshot; never replay old SSE. */
  partnerArrival(event: { orderId?: unknown; riderId?: unknown; arrivedAt?: unknown }, gps: RiderGpsSnapshot, now = Date.now()) {
    const active = this.active;
    if (!active || active.kind !== "arrived_store" || active.consumed
      || event.orderId !== active.orderId || event.riderId !== active.riderId) return;
    const arrivedAt = actualTime(event.arrivedAt, now);
    const fix = arrivalAcknowledgedFix(gps, now);
    if (arrivedAt == null || !fix || fix.timestamp < active.boundAt
      || arrivedAt < active.boundAt || now - arrivedAt > riderGpsFixMaxAgeMs) return;
    this.consume(true, fix);
  }

  private consume(audibleRequest: boolean, fix?: GpsFix) {
    const active = this.active;
    if (!active || active.consumed) return;
    active.consumed = true;
    // Fail closed when persistence is unavailable: at-most-once cannot be proven after remount.
    if (!this.port.consume(active.key)) return;
    if (!audibleRequest || !fix) return;
    const revision = this.revision;
    this.port.retain([active.key]);
    // This is a derived notification deadline, not a fabricated provider/arrival/ACK timestamp.
    const expiresAt = new Date(fix.timestamp + riderGpsFixMaxAgeMs).toISOString();
    this.port.notify(active.kind, active.key, () => revision === this.revision && this.active === active, expiresAt);
  }
}
