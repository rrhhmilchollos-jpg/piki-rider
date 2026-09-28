import { useEffect } from "react";
import { publishRiderLocation } from "../integrations/piki-api";

type Props = { token: string; riderId?: string; active?: boolean; onError: (message: string) => void };
type Point = { lat: number; lng: number; accuracy: number };

/** GPS reporting never depends on a Google Maps key: the map is visual-only. */
export default function LiveGoogleMap({ token, riderId, active = false, onError }: Props) {

  useEffect(() => {
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
      const failure = (error: GeolocationPositionError) => {
        if (error.code === error.PERMISSION_DENIED) onError("Ubicación bloqueada: permite la ubicación para recibir pedidos.");
        else if (error.code === error.POSITION_UNAVAILABLE) onError("GPS no disponible: activa la ubicación precisa del teléfono.");
        else onError("GPS sin respuesta: mantén la app abierta y vuelve a intentarlo.");
      };
      watchId = navigator.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
      // Some Android browsers do not emit watchPosition updates while the
      // device is stationary. Force an initial publish and keep a heartbeat.
      navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 });
      heartbeat = window.setInterval(() => { if (document.visibilityState === "visible") navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }); }, 10_000);
    };
    beginGps();
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (heartbeat !== undefined) window.clearInterval(heartbeat); };
  }, [active, onError, riderId, token]);

  // The rider must not see internal GPS, zone or coverage information.
  return null;
}
