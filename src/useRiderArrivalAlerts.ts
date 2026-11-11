import { useEffect, useState } from "react";
import { usesAndroidGps } from "./riderGpsNative";
import { getRiderGpsSnapshot, useRiderGpsSnapshot } from "./riderGpsState";
import { RIDER_GPS_STOP_EVENT } from "./riderGpsSession";
import { arrivalAcknowledgedFix, RiderArrivalAlerts } from "./riderArrivalAlerts";
import { queueRiderNativeAlert, retainRiderNativeArrivalAlerts } from "./riderNativeNotifications";
import type { RiderOffer } from "./types/rider";

/** Persistent tombstones contain only rider/order/phase keys; unavailable storage disables sound safely. */
function alreadyConsumed(key: string) {
  try { return localStorage.getItem(key) === "consumed"; } catch { return true; }
}
function consume(key: string) {
  try {
    if (localStorage.getItem(key) === "consumed") return false;
    localStorage.setItem(key, "consumed");
    return localStorage.getItem(key) === "consumed";
  } catch { return false; }
}
export function useRiderArrivalAlerts(input: {
  riderId: string;
  order: RiderOffer | null;
  enabled: boolean;
  consent: boolean;
  isOrderCancelled: (orderId: string) => boolean;
}) {
  const { riderId, order, enabled, consent, isOrderCancelled } = input;
  const gps = useRiderGpsSnapshot();
  const [controller] = useState(() => new RiderArrivalAlerts({
    consumed: alreadyConsumed, consume,
    retain: (keys) => { void retainRiderNativeArrivalAlerts(keys); },
    notify: (kind, key, isCurrent, expiresAt) => {
      queueRiderNativeAlert(kind, true, key, expiresAt, () => isCurrent()
        && usesAndroidGps() && arrivalAcknowledgedFix(getRiderGpsSnapshot(), Date.now()) !== null);
    },
  }));
  useEffect(() => {
    controller.setContext({ riderId, order: order && !isOrderCancelled(order._id) ? order : null,
      enabled: enabled && usesAndroidGps(), consent }, gps);
    controller.observe(gps);
  }, [controller, riderId, order, enabled, consent, isOrderCancelled, gps]);
  useEffect(() => {
    const invalidate = () => controller.reset();
    // A newly online device must establish a new silent baseline, never infer a crossing offline.
    window.addEventListener("online", invalidate);
    window.addEventListener(RIDER_GPS_STOP_EVENT, invalidate);
    return () => {
      window.removeEventListener("online", invalidate);
      window.removeEventListener(RIDER_GPS_STOP_EVENT, invalidate);
      controller.reset();
    };
  }, [controller]);
  return controller;
}
