import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../integrations/google-maps";
import { loadOperationalZones, publishRiderLocation, type OperationalZone } from "../integrations/piki-api";
import { toGoogleZonePaths } from "../algorithms/zone-coverage";

type Props = { token: string; riderId?: string; onError: (message: string) => void };
const XATIVA: google.maps.LatLngLiteral = { lat: 38.9908, lng: -0.5185 };

export default function LiveGoogleMap({ token, riderId, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const [zones, setZones] = useState<OperationalZone[]>([]);
  const [locationState, setLocationState] = useState("Solicitando ubicación…");

  useEffect(() => {
    let disposed = false;
    let watchId: number | undefined;
    let locationTimer: number | undefined;

    async function start() {
      try {
        const maps = await loadGoogleMaps();
        if (disposed || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, { center: XATIVA, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
        mapRef.current = map;
        markerRef.current = new maps.Marker({ map, position: XATIVA, title: "Tu ubicación PIKI", zIndex: 20 });
        const loadedZones = await loadOperationalZones(token);
        if (disposed) return;
        setZones(loadedZones);
        for (const item of toGoogleZonePaths(loadedZones)) {
          const polygon = new maps.Polygon({ map, paths: item.path, strokeColor: "#84CC16", strokeOpacity: 0.95, strokeWeight: 2, fillColor: "#84CC16", fillOpacity: 0.12 });
          polygonsRef.current.push(polygon);
        }
        if (!navigator.geolocation) throw new Error("Este dispositivo no ofrece geolocalización");
        watchId = navigator.geolocation.watchPosition(async (position) => {
          const point = { lat: position.coords.latitude, lng: position.coords.longitude };
          map.setCenter(point);
          if (markerRef.current) markerRef.current.setPosition(point);
          setLocationState(`GPS activo · precisión ±${Math.round(position.coords.accuracy)} m`);
          if (riderId) {
            try { await publishRiderLocation(token, riderId, { latitude: point.lat, longitude: point.lng, accuracy: position.coords.accuracy }); }
            catch (error) { onError(error instanceof Error ? error.message : "No se pudo publicar la ubicación"); }
          }
        }, (error) => { setLocationState("Ubicación no autorizada"); onError(error.message); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
        locationTimer = window.setInterval(() => {
          if (document.visibilityState === "visible" && riderId) navigator.geolocation.getCurrentPosition(() => undefined, () => undefined, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
        }, 15000);
      } catch (error) { onError(error instanceof Error ? error.message : "No se pudo cargar Google Maps"); }
    }
    void start();
    return () => { disposed = true; if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (locationTimer) window.clearInterval(locationTimer); markerRef.current?.setMap(null); polygonsRef.current.forEach((polygon) => polygon.setMap(null)); polygonsRef.current = []; };
  }, [onError, riderId, token]);

  return <section className="real-map-shell" aria-label="Google Maps en vivo"><div ref={containerRef} className="google-map-canvas"/><div className="real-map-status"><span className="gps-dot" />{locationState}<strong>{zones.filter((zone) => zone.isActive !== false).length} zonas activas</strong></div></section>;
}
