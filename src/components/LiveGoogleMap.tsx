import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { loadOperationalZones, publishRiderLocation, type OperationalZone } from "../integrations/piki-api";
import { loadGoogleMaps } from "../integrations/google-maps";

type Props = { token: string; riderId?: string; active?: boolean; onError: (message: string) => void };
type Point = { lat: number; lng: number; accuracy: number };

const XATIVA_CENTER = { lat: 38.9908, lng: -0.5185 };

/** Mapa operativo: muestra la zona autorizada y la posición del dispositivo sin persistir GPS adicional. */
export default function LiveGoogleMap({ token, riderId, active = false, onError }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const zonesRef = useRef<google.maps.Polygon[]>([]);
  const lastPointRef = useRef<Point | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadGoogleMaps(), loadOperationalZones(token)]).then(([maps, zones]) => {
      if (disposed || !mapElement.current) return;
      const map = new maps.Map(mapElement.current, { center: XATIVA_CENTER, zoom: 13, disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy" });
      mapRef.current = map;
      zonesRef.current = (zones as OperationalZone[]).flatMap((zone) => {
        const outer = zone.polygon?.coordinates?.[0] || [];
        if (outer.length < 3) return [];
        const polygon = new maps.Polygon({ paths: outer.map(([lng, lat]) => ({ lat, lng })), strokeColor: "#0b806c", strokeOpacity: 0.95, strokeWeight: 3, fillColor: "#c9ff52", fillOpacity: 0.12, map });
        return [polygon];
      });
      setMapReady(true);
      if (!zones.length) onError("No se han cargado las zonas operativas; contacta con Fleet.");
    }).catch((error) => { if (!disposed) onError(error instanceof Error ? error.message : "No se pudo cargar el mapa operativo"); });
    return () => { disposed = true; zonesRef.current.forEach((polygon) => polygon.setMap(null)); zonesRef.current = []; mapRef.current = null; };
  }, [onError, token]);

  useEffect(() => {
    let watchId: number | undefined;
    let heartbeat: number | undefined;
    const publish = async (point: Point) => {
      if (!riderId) return;
      lastPointRef.current = point;
      if (mapRef.current) {
        mapRef.current.setCenter({ lat: point.lat, lng: point.lng });
        if (!markerRef.current) markerRef.current = new google.maps.Marker({ map: mapRef.current, position: { lat: point.lat, lng: point.lng }, title: "Tu ubicación" });
        else markerRef.current.setPosition({ lat: point.lat, lng: point.lng });
      }
      try { await publishRiderLocation(token, riderId, { latitude: point.lat, longitude: point.lng, accuracy: Number.isFinite(point.accuracy) ? Math.min(100000, Math.max(0, point.accuracy)) : undefined }); }
      catch (error) { onError(error instanceof Error ? error.message : "No se pudo actualizar el servicio"); }
    };
    if (!active || !navigator.geolocation) return;
    const success = (position: GeolocationPosition) => void publish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
    const failure = (error: GeolocationPositionError) => { if (error.code === error.PERMISSION_DENIED) onError("Ubicación bloqueada: permite la ubicación para recibir pedidos."); else if (error.code === error.POSITION_UNAVAILABLE) onError("GPS no disponible: activa la ubicación precisa del teléfono."); };
    watchId = navigator.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    heartbeat = window.setInterval(() => { if (document.visibilityState === "visible") navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }); }, 10000);
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (heartbeat !== undefined) window.clearInterval(heartbeat); };
  }, [active, onError, riderId, token, mapReady]);

  const recenter = () => { const point = lastPointRef.current; if (point && mapRef.current) { mapRef.current.setCenter({ lat: point.lat, lng: point.lng }); mapRef.current.setZoom(16); } else onError("Aún no hay una ubicación GPS disponible."); };
  return <div className="live-rider-map" aria-label="Mapa operativo y geocerca de Xàtiva">
    <div ref={mapElement} className="live-rider-map-canvas" />
    <button type="button" className="live-rider-map-recenter" onClick={recenter} aria-label="Volver a mi ubicación"><LocateFixed size={20} /></button>
    {!mapReady && <div className="live-rider-map-loading">Cargando mapa operativo…</div>}
  </div>;
}
