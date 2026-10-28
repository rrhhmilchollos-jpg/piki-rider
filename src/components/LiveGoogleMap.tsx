import { useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { loadGoogleMaps } from "../integrations/google-maps";
import { useRiderGpsMapPoint, useRiderGpsSnapshot } from "../riderGpsState";

type Props = { active?: boolean };
type MapState = "loading" | "ready" | "fallback";

const fallbackPoint = { lat: 38.9908, lng: -0.5185 };

/**
 * Displays the canonical GPS stream owned by RiderGpsTracker. It never starts
 * a watcher or publishes a location, so rendering cannot create a second GPS publisher.
 */
export default function LiveGoogleMap({ active = false }: Props) {
  const point = useRiderGpsMapPoint();
  const gps = useRiderGpsSnapshot();
  const [mapCenter, setMapCenter] = useState(fallbackPoint);
  const fallbackCenterRef = useRef(fallbackPoint);
  const hasGpsCenterRef = useRef(false);
  const lastFallbackCenterUpdateRef = useRef(0);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapMessage, setMapMessage] = useState("");
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const handleAuthFailure = () => {
      if (cancelled) return;
      setMapState("fallback");
      setMapMessage("La clave de Google Maps no está autorizada. Mostramos el mapa Google básico.");
    };
    window.addEventListener("piki-google-maps-auth-failure", handleAuthFailure);
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
        setMapState("fallback");
        setMapMessage(message.includes("GOOGLE_MAPS_AUTH_FAILURE")
          ? "La clave de Google Maps no está autorizada. Mostramos el mapa Google básico."
          : message.includes("VITE_GOOGLE_MAPS_API_KEY") || message.includes("KEY_MISSING")
            ? "Falta configurar la clave de Maps; mostramos el mapa Google básico."
            : "No se pudo cargar el mapa interactivo; mostramos el mapa Google básico.");
      });
    return () => {
      cancelled = true;
      window.removeEventListener("piki-google-maps-auth-failure", handleAuthFailure);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || mapState !== "ready") return;
    const center = point ?? fallbackPoint;
    map.panTo(center);
    if (!markerRef.current) {
      markerRef.current = new maps.Marker({ map, position: center, title: "Tu posición GPS" });
    } else {
      markerRef.current.setPosition(center);
    }
  }, [point, mapState]);

  useEffect(() => {
    if (!point) return;
    const previousCenter = fallbackCenterRef.current;
    const deltaLat = (point.lat - previousCenter.lat) * 111_000;
    const deltaLng = (point.lng - previousCenter.lng) * 85_000;
    const fallbackMovedMeters = Math.hypot(deltaLat, deltaLng);
    const now = Date.now();
    if (!hasGpsCenterRef.current || fallbackMovedMeters >= 120 || now - lastFallbackCenterUpdateRef.current >= 60_000) {
      const nextCenter = { lat: point.lat, lng: point.lng };
      hasGpsCenterRef.current = true;
      fallbackCenterRef.current = nextCenter;
      lastFallbackCenterUpdateRef.current = now;
      setMapCenter(nextCenter);
    }
  }, [point]);

  const accuracy = Number(point?.accuracy);
  const precision = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 500
    ? ` · precisión aproximada ±${Math.round(accuracy)} m`
    : " · precisión no disponible";
  const locationMessage = !point
    ? active
      ? "GPS activo · esperando una posición y la confirmación de la API"
      : "Mapa centrado en Xàtiva · activa la jornada para compartir tu posición"
    : gps.state === "tracking"
      ? `GPS confirmado por la API${precision}`
      : `Posición GPS recibida; esperando confirmación de la API${precision}`;
  const center = point ?? fallbackPoint;
  const fallbackMapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${mapCenter.lat},${mapCenter.lng}`)}&z=15&output=embed`;

  return <div className="rider-map-card">
    <div className="rider-map-status" aria-live="polite">{locationMessage}</div>
    <div ref={mapNodeRef} className="rider-google-map-canvas" style={{ display: mapState === "fallback" ? "none" : undefined }} aria-label="Mapa Google Maps con tu posición GPS en directo" />
    {mapState === "loading" && <div className="rider-google-map-loading"><RefreshCw className="spin" size={20} /><span>Cargando Google Maps…</span></div>}
    {mapState === "fallback" && <iframe title="Mapa de Google Maps con tu posición GPS" className="rider-google-map-frame" src={fallbackMapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
    {mapState === "fallback" && mapMessage && <div className="rider-google-map-notice" role="status"><MapPin size={16} />{mapMessage}</div>}
    <a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${center.lat},${center.lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
  </div>;
}
