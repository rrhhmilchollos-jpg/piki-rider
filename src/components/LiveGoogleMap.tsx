import { useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { loadGoogleMaps } from "../integrations/google-maps";
import { useRiderGpsMapPoint, useRiderGpsSnapshot } from "../riderGpsState";
import { ringsOf, useDeliveryZone } from "../riderGeofence";
import { startRiderDeviceGps } from "../riderGpsSession";

type Props = { active?: boolean; apiOrigin?: string; token?: string; riderId?: string };
type MapState = "loading" | "ready" | "unavailable";

/**
 * Displays only the canonical GPS stream owned by RiderGpsTracker. It never
 * starts a watcher, publishes a location, or supplies a geographic fallback.
 */
export default function LiveGoogleMap({ active = false, apiOrigin = "", token = "", riderId = "" }: Props) {
  const deliveryZone = useDeliveryZone(apiOrigin, token, riderId);
  const point = useRiderGpsMapPoint();
  const gps = useRiderGpsSnapshot();
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapMessage, setMapMessage] = useState("");
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapsApiRef = useRef<typeof google.maps | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const zoneRef = useRef<any[]>([]);

  const clearRenderedMap = () => {
    markerRef.current?.setMap?.(null);
    markerRef.current = null;
    zoneRef.current.forEach((shape) => shape?.setMap?.(null));
    zoneRef.current = [];
    mapRef.current = null;
    mapNodeRef.current?.replaceChildren();
  };

  useEffect(() => {
    let cancelled = false;
    const handleAuthFailure = () => {
      if (cancelled) return;
      clearRenderedMap();
      setMapState("unavailable");
      setMapMessage("Google Maps no autorizó la configuración actual. No se sustituye ninguna clave ni se muestra una ubicación alternativa.");
    };
    window.addEventListener("piki-google-maps-auth-failure", handleAuthFailure);
    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled) return;
        mapsApiRef.current = maps;
        setMapState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        clearRenderedMap();
        const message = error instanceof Error ? error.message : "";
        setMapState("unavailable");
        setMapMessage(message.includes("GOOGLE_MAPS_AUTH_FAILURE")
          ? "Google Maps no autorizó la configuración actual. No se sustituye ninguna clave ni se muestra una ubicación alternativa."
          : message.includes("VITE_GOOGLE_MAPS_API_KEY") || message.includes("KEY_MISSING")
            ? "El mapa interactivo no está configurado para esta sesión. El GPS no se reemplaza por una ubicación predeterminada."
            : "El mapa interactivo no está disponible temporalmente. La app no sustituye credenciales ni datos de ubicación.");
      });
    return () => {
      cancelled = true;
      window.removeEventListener("piki-google-maps-auth-failure", handleAuthFailure);
      clearRenderedMap();
    };
  }, []);

  useEffect(() => {
    const maps = mapsApiRef.current;
    if (mapState !== "ready" || !maps) return;
    if (!point) {
      clearRenderedMap();
      return;
    }
    if (!mapNodeRef.current) return;
    const center = { lat: point.lat, lng: point.lng };
    const map = mapRef.current ||= new maps.Map(mapNodeRef.current, {
      center,
      zoom: 15,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
    map.panTo(center);
    if (!markerRef.current) {
      markerRef.current = new maps.Marker({ map, position: center, title: "Tu posición GPS" });
    } else {
      markerRef.current.setPosition(center);
    }
  }, [point, mapState]);

  useEffect(() => {
    const maps = mapsApiRef.current;
    const map = mapRef.current;
    if (mapState !== "ready" || !maps || !map) return;
    zoneRef.current.forEach((shape) => shape?.setMap?.(null));
    zoneRef.current = [];
    const geometry = deliveryZone?.geometry;
    if (!geometry) return;
    zoneRef.current = ringsOf(geometry)
      .filter((ring) => ring.length > 2)
      .map((ring) => new maps.Polygon({
        map,
        paths: ring.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: "#4b7f2a",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#9be15d",
        fillOpacity: 0.12,
        clickable: false,
      }));
    if (zoneRef.current.length && point) {
      const bounds = new (maps as any).LatLngBounds();
      zoneRef.current.forEach((shape) => shape.getPath().forEach((latLng: any) => bounds.extend(latLng)));
      map.fitBounds(bounds, 40);
    }
  }, [deliveryZone, mapState, point]);

  const accuracy = Number(point?.accuracy);
  const precision = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 500
    ? ` · precisión aproximada ±${Math.round(accuracy)} m`
    : " · precisión no disponible";
  const fallbackMapUrl = point
    ? (() => {
        const lat = Number(point.lat);
        const lng = Number(point.lng);
        const delta = 0.008;
        const params = new URLSearchParams({
          bbox: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`,
          layer: "mapnik",
          marker: `${lat},${lng}`,
        });
        return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
      })()
    : "";
  const locationMessage = !point
    ? active
      ? "GPS activo · esperando la primera posición real de esta sesión"
      : "Activa la jornada para solicitar una posición GPS real; no se usa un centro predeterminado"
    : gps.state === "tracking"
      ? `GPS confirmado por la API${precision}`
      : `Posición GPS propia recibida; esperando confirmación de la API${precision}`;
  const retryGps = () => {
    startRiderDeviceGps();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => undefined,
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  };

  return <div className="rider-map-card">
    <div className="rider-map-status" aria-live="polite">{locationMessage}</div>
    {mapState === "loading" && <div className="rider-google-map-loading"><RefreshCw className="spin" size={20} /><span>Cargando Google Maps…</span></div>}
    {mapState === "ready" && !point && <div className="rider-google-map-placeholder"><MapPin size={26} /><strong>Esperando tu GPS</strong><span>El mapa se habilita solo cuando esta sesión aporta una posición real.</span>{active && <button type="button" className="primary-button" onClick={retryGps}>Activar o reintentar GPS</button>}</div>}
    <div ref={mapNodeRef} className="rider-google-map-canvas" style={{ display: mapState === "ready" && point ? undefined : "none" }} aria-label="Mapa Google Maps con tu posición GPS propia" />
    {mapState === "unavailable" && point && <iframe className="rider-google-map-canvas rider-map-fallback" title="Mapa de ubicación GPS del Rider" src={fallbackMapUrl} loading="lazy" referrerPolicy="no-referrer" style={{ display: "block", width: "100%", minHeight: "390px", border: 0 }} />}
    {mapState === "unavailable" && !point && <div className="rider-google-map-placeholder rider-google-map-error"><MapPin size={26} /><strong>Mapa pendiente de GPS</strong><span>{mapMessage} {active ? "Activa la ubicación precisa y solicita una nueva posición; el mapa aparecerá cuando el backend confirme una posición real." : "Activa la jornada para solicitar una posición GPS real."}</span>{active && <button type="button" className="primary-button" onClick={retryGps}>Activar o reintentar GPS</button>}</div>}
    {point && <a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`} target="_blank" rel="noreferrer">Abrir mi posición en Google Maps</a>}
  </div>;
}
