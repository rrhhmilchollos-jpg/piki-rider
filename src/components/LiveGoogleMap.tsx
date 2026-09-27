import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../integrations/google-maps";
import { loadOperationalZones, publishRiderLocation, type OperationalZone } from "../integrations/piki-api";
import { toGoogleZonePaths } from "../algorithms/zone-coverage";

type Props = { token: string; riderId?: string; active?: boolean; onError: (message: string) => void };
const XATIVA: google.maps.LatLngLiteral = { lat: 38.9908, lng: -0.5185 };
type Point = { lat: number; lng: number; accuracy: number };

/** GPS reporting never depends on a Google Maps key: the map is visual-only. */
export default function LiveGoogleMap({ token, riderId, active = false, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const lastPointRef = useRef<Point | null>(null);
  const [zones, setZones] = useState<OperationalZone[]>([]);
  const [zonesState, setZonesState] = useState<"loading" | "ready" | "error">("loading");
  const [locationState, setLocationState] = useState(active ? "Solicitando GPS real…" : "Activa una jornada para compartir ubicación");
  const [gpsRetryKey, setGpsRetryKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let watchId: number | undefined;
    let heartbeat: number | undefined;
    const publish = async (point: Point) => {
      lastPointRef.current = point;
      if (mapRef.current) mapRef.current.setCenter(point);
      markerRef.current?.setPosition(point);
      setLocationState(`GPS activo · precisión ±${Math.round(point.accuracy)} m`);
      if (!riderId) return;
      try { await publishRiderLocation(token, riderId, { latitude: point.lat, longitude: point.lng, accuracy: point.accuracy }); }
      catch (error) { onError(error instanceof Error ? error.message : "No se pudo publicar la ubicación"); }
    };
    const beginGps = () => {
      if (!active) return;
      if (!navigator.geolocation) { setLocationState("GPS no disponible"); onError("Este dispositivo no ofrece geolocalización"); return; }
      const success = (position: GeolocationPosition) => void publish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
      const failure = (error: GeolocationPositionError) => { setLocationState(error.code === error.PERMISSION_DENIED ? "Permiso GPS no concedido" : "GPS temporalmente no disponible"); onError(error.code === error.PERMISSION_DENIED ? "Activa el permiso de ubicación del navegador para publicar tu posición." : error.message || "No se ha podido obtener la ubicación."); };
      watchId = navigator.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
      heartbeat = window.setInterval(() => { if (document.visibilityState === "visible") navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }); }, 15_000);
    };
    const beginMap = async () => {
      let maps: typeof google.maps | null = null;
      try {
        maps = await loadGoogleMaps();
      } catch {
        if (!lastPointRef.current) setLocationState(active ? "GPS activo · mapa no disponible" : "Mapa no disponible");
      }
      if (maps && !disposed && containerRef.current) {
        const point = lastPointRef.current || XATIVA;
        const map = new maps.Map(containerRef.current, { center: point, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
        mapRef.current = map;
        markerRef.current = new maps.Marker({ map, position: point, title: active ? "Ubicación PIKI" : "Centro operativo Xàtiva", zIndex: 20 });
      }
      try {
        const loadedZones = await loadOperationalZones(token);
        if (disposed) return;
        setZones(loadedZones);
        setZonesState("ready");
        if (maps && mapRef.current) for (const item of toGoogleZonePaths(loadedZones)) polygonsRef.current.push(new maps.Polygon({ map: mapRef.current, paths: item.path, strokeColor: "#84CC16", strokeOpacity: 0.95, strokeWeight: 2, fillColor: "#84CC16", fillOpacity: 0.12 }));
      } catch {
        if (!disposed) setZonesState("error");
      }
    };
    beginGps(); void beginMap();
    return () => { disposed = true; if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (heartbeat !== undefined) window.clearInterval(heartbeat); markerRef.current?.setMap(null); polygonsRef.current.forEach((polygon) => polygon.setMap(null)); polygonsRef.current = []; mapRef.current = null; };
  }, [active, gpsRetryKey, onError, riderId, token]);

  const activeZoneCount = zones.filter((zone) => zone.isActive !== false).length;
  const zoneLabel = zonesState === "loading" ? "Cargando zonas…" : zonesState === "error" ? "Zonas no disponibles" : `${activeZoneCount} zonas activas`;
  return <section className="real-map-shell" aria-label="Ubicación GPS en vivo"><div ref={containerRef} className="google-map-canvas"/><div className="real-map-status"><span className="gps-dot" />{locationState}{(locationState.includes("Permiso") || locationState.includes("no disponible")) && <button type="button" onClick={() => setGpsRetryKey((value) => value + 1)}>Reintentar GPS</button>}<strong>{zoneLabel}</strong></div></section>;
}
