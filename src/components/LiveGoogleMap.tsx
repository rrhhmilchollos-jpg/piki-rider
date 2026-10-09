import { useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { publishRiderLocation } from "../integrations/piki-api";
import { loadGoogleMaps } from "../integrations/google-maps";

type Props = { token: string; riderId?: string; active?: boolean; nativeTracking?: boolean; onError: (message: string) => void };
type Point = { lat: number; lng: number; accuracy: number };
type MapState = "loading" | "ready" | "fallback" | "error";

const fallbackPoint = { lat: 38.9908, lng: -0.5185 };

/**
 * Publishes the Rider's device GPS independently from map rendering. When the
 * Maps JavaScript API key is configured, it renders the real Google base map
 * and moves the Rider marker using those exact device coordinates.
 */
export default function LiveGoogleMap({ token, riderId, active = false, nativeTracking = false, onError }: Props) {
  const [point, setPoint] = useState<Point | null>(null);
  const [mapCenter, setMapCenter] = useState(fallbackPoint);
  const [locationMessage, setLocationMessage] = useState("Mapa centrado en Xàtiva · activa la jornada para compartir tu posición");
  const [mapState, setMapState] = useState<MapState>("loading");
  const onErrorRef = useRef(onError);
  const lastPublishedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapNodeRef.current) return;
        mapRef.current ||= new maps.Map(mapNodeRef.current, {
          center: fallbackPoint,
          zoom: 15,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        setMapState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setMapState(message.includes("VITE_GOOGLE_MAPS_API_KEY") || message.includes("KEY_MISSING") ? "fallback" : "error");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || mapState !== "ready") return;
    const center = point ?? fallbackPoint;
    map.panTo(center);
    if (!markerRef.current) {
      markerRef.current = new maps.Marker({
        map,
        position: center,
        title: "Tu posición GPS",
      });
    } else {
      markerRef.current.setPosition(center);
    }
  }, [point, mapState]);

  useEffect(() => {
    let watchId: number | undefined;
    let heartbeat: number | undefined;
    const publish = async (next: Point) => {
      setPoint(next);
      setMapCenter((previous) => previous === fallbackPoint ? { lat: next.lat, lng: next.lng } : previous);
      setLocationMessage(`GPS actualizado · precisión aproximada ${Math.round(next.accuracy)} m`);
      if (!active || !riderId || nativeTracking) return;
      const previous = lastPublishedRef.current;
      const elapsed = previous ? Date.now() - previous.at : Number.POSITIVE_INFINITY;
      const movedMeters = previous ? Math.hypot((next.lat - previous.lat) * 111_000, (next.lng - previous.lng) * 88_000) : Number.POSITIVE_INFINITY;
      if (elapsed < 4_000 && movedMeters < 12) return;
      lastPublishedRef.current = { lat: next.lat, lng: next.lng, at: Date.now() };
      try {
        await publishRiderLocation(token, riderId, { latitude: next.lat, longitude: next.lng, accuracy: next.accuracy });
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : "No se pudo actualizar el servicio");
      }
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
    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
    };
  }, [active, nativeTracking, riderId, token]);

  const center = point ?? fallbackPoint;
  const fallbackMapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${mapCenter.lat},${mapCenter.lng}`)}&z=15&output=embed`;

  return <div className="rider-map-card">
    <div className="rider-map-status" aria-live="polite">{locationMessage}</div>
    <div ref={mapNodeRef} className="rider-google-map-canvas" style={{ display: mapState === "fallback" || mapState === "error" ? "none" : undefined }} aria-label="Mapa Google Maps con tu posición GPS en directo" />
    {mapState === "loading" && <div className="rider-google-map-loading"><RefreshCw className="spin" size={20} /><span>Cargando Google Maps…</span></div>}
    {mapState === "fallback" && <iframe title="Mapa de Google Maps con tu posición GPS" className="rider-google-map-frame" src={fallbackMapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
    {mapState === "error" && <div className="rider-google-map-loading rider-google-map-error"><MapPin size={20} /><span>No se pudo cargar Google Maps. Comprueba la clave y las restricciones del dominio.</span></div>}
    <a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${center.lat},${center.lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
  </div>;
}
