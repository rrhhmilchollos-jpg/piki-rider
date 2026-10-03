import { useEffect, useMemo, useRef, useState } from "react";
import { publishRiderLocation } from "../integrations/piki-api";

type Props = { token: string; riderId?: string; active?: boolean; onError: (message: string) => void };
type Point = { lat: number; lng: number; accuracy: number };
const fallbackPoint = { lat: 38.9908, lng: -0.5185 };

/** Visible map with GPS publishing independent from Google Maps credentials. */
export default function LiveGoogleMap({ token, riderId, active = false, onError }: Props) {
  const [point, setPoint] = useState<Point | null>(null);
  const [locationMessage, setLocationMessage] = useState("Mapa centrado en Xàtiva · activa la jornada para compartir tu posición");
  const onErrorRef = useRef(onError);
  const lastPublishedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => {
    let watchId: number | undefined;
    let heartbeat: number | undefined;
    const publish = async (next: Point) => {
      setPoint(next);
      setLocationMessage(`GPS actualizado · precisión aproximada ${Math.round(next.accuracy)} m`);
      if (!active || !riderId) return;
      const previous = lastPublishedRef.current;
      const elapsed = previous ? Date.now() - previous.at : Number.POSITIVE_INFINITY;
      const movedMeters = previous ? Math.hypot((next.lat - previous.lat) * 111_000, (next.lng - previous.lng) * 88_000) : Number.POSITIVE_INFINITY;
      if (elapsed < 4_000 && movedMeters < 12) return;
      lastPublishedRef.current = { lat: next.lat, lng: next.lng, at: Date.now() };
      try { await publishRiderLocation(token, riderId, { latitude: next.lat, longitude: next.lng, accuracy: next.accuracy }); }
      catch (error) { onErrorRef.current(error instanceof Error ? error.message : "No se pudo actualizar el servicio"); }
    };
    const failure = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) onErrorRef.current("Ubicación bloqueada: permite la ubicación para recibir pedidos.");
      else if (error.code === error.POSITION_UNAVAILABLE) onErrorRef.current("GPS no disponible: activa la ubicación precisa del teléfono.");
      else onErrorRef.current("GPS sin respuesta: mantén la app abierta y vuelve a intentarlo.");
    };
    if (navigator.geolocation) {
      const success = (position: GeolocationPosition) => void publish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
      navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 });
      if (active) {
        watchId = navigator.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
        heartbeat = window.setInterval(() => { navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }); }, 10_000);
      }
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (heartbeat !== undefined) window.clearInterval(heartbeat); };
  }, [active, riderId, token]);
  const center = point ?? fallbackPoint;
  const mapUrl = useMemo(() => `https://www.google.com/maps?q=${encodeURIComponent(`${center.lat},${center.lng}`)}&z=15&output=embed`, [center.lat, center.lng]);
  return <div className="rider-map-card"><div className="rider-map-status">{locationMessage}</div><iframe title="Mapa operativo de Google Maps" className="rider-google-map-frame" src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${center.lat},${center.lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a></div>;
}
