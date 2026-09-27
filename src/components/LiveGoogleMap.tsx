import { useEffect } from "react";
import { publishRiderLocation } from "../integrations/piki-api";

type Props = { token: string; riderId?: string; active?: boolean; onError: (message: string) => void };
type Point = { lat: number; lng: number; accuracy: number };

/** GPS reporting never depends on a Google Maps key: the map is visual-only. */
export default function LiveGoogleMap({ token, riderId, active = false, onError }: Props) {

  useEffect(() => {
    void onError;
    let watchId: number | undefined;
    let heartbeat: number | undefined;
    const publish = async (point: Point) => {
      if (!riderId) return;
      try { await publishRiderLocation(token, riderId, { latitude: point.lat, longitude: point.lng, accuracy: point.accuracy }); }
      catch (error) { onError(error instanceof Error ? error.message : "No se pudo actualizar el servicio"); }
    };
    const beginGps = () => {
      if (!active) return;
      if (!navigator.geolocation) { onError("No se pudo activar el servicio de ubicación"); return; }
      const success = (position: GeolocationPosition) => void publish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
      const failure = (_error: GeolocationPositionError) => { /* GPS remains an internal service detail. */ };
      watchId = navigator.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
      heartbeat = window.setInterval(() => { if (document.visibilityState === "visible") navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }); }, 15_000);
    };
    beginGps();
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (heartbeat !== undefined) window.clearInterval(heartbeat); };
  }, [active, onError, riderId, token]);

  // The rider must not see internal GPS, zone or coverage information.
  return null;
}
