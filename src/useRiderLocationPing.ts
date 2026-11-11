import { useEffect, useRef } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { useRiderGpsMapPoint, useRiderGpsSnapshot } from "./riderGpsState";
import { riderGpsFixMaxAgeMs, riderOrderGpsMaxAccuracyMeters } from "./riderGpsPolicy";
type Options = { apiOrigin: string; token: string; publicCode: string | null; enabled: boolean; intervalMs?: number };
/** Order tracking consumes the same validated provider fixes as the map; no second WebView watcher. */
export function useRiderLocationPing({ apiOrigin, token, publicCode, enabled, intervalMs = 5000 }: Options) {
  const point = useRiderGpsMapPoint();
  const gps = useRiderGpsSnapshot();
  const lastSent = useRef<{ scope: string; at: number }>({ scope: "", at: 0 });
  useEffect(() => {
    if (!enabled || !publicCode || !token.trim() || !point || !gps.lastFixAt || gps.state === "idle" || gps.state === "error") return;
    const now = Date.now();
    if (gps.lastFixAt > now || now - gps.lastFixAt > riderGpsFixMaxAgeMs || point.accuracy > riderOrderGpsMaxAccuracyMeters) return;
    const scope = `${token}:${publicCode}`;
    if (lastSent.current.scope === scope && gps.lastFixAt - lastSent.current.at < intervalMs) return;
    lastSent.current = { scope, at: gps.lastFixAt };
    const url = `${apiOrigin}/api/v1/orders/${encodeURIComponent(publicCode)}/location`;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` };
    const data = { latitude: point.lat, longitude: point.lng, accuracyMeters: point.accuracy, headingDegrees: point.heading };
    // Real timestamp is local evidence only; the established API schema stays unchanged.
    const request = Capacitor.isNativePlatform()
      ? CapacitorHttp.post({ url, headers, data, connectTimeout: 15_000, readTimeout: 15_000 })
      : fetch(url, { method: "POST", headers, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
    void request.catch(() => { /* A later new fix may retry, never a timer replay. */ });
  }, [apiOrigin, token, publicCode, enabled, intervalMs, point, gps.lastFixAt, gps.state]);
}
