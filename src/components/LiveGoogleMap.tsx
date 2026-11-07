import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, MapPin, Navigation } from "lucide-react";
import { useRiderGpsMapPoint, useRiderGpsSnapshot } from "../riderGpsState";
import { ringsOf, useDeliveryZone } from "../riderGeofence";

type Props = { active?: boolean; apiOrigin?: string; token?: string; riderId?: string };

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap";
const RIDER_ICON_SIZE = 56;

function riderIcon(heading?: number) {
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({
    className: "rider-heading-icon-wrap",
    iconSize: [RIDER_ICON_SIZE, RIDER_ICON_SIZE],
    iconAnchor: [RIDER_ICON_SIZE / 2, RIDER_ICON_SIZE / 2],
    html: `<div class="rider-heading-marker" aria-hidden="true">
      <span class="rider-heading-beam" style="transform: rotate(${safeHeading}deg)"></span>
      <span class="rider-heading-dot"><span></span></span>
    </div>`,
  });
}

/**
 * Mapa del rider con Leaflet y teselas de OpenStreetMap. La posición solo se
 * dibuja cuando procede del GPS real; el haz azul apunta al rumbo del dispositivo.
 */
export default function LiveGoogleMap({ active = false, apiOrigin = "", token = "", riderId = "" }: Props) {
  const deliveryZone = useDeliveryZone(apiOrigin, token, riderId);
  const point = useRiderGpsMapPoint();
  const gps = useRiderGpsSnapshot();
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const zoneRef = useRef<L.Polygon[]>([]);
  const initialCenterDoneRef = useRef(false);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, { zoomControl: true, attributionControl: true }).setView([38.9887, -0.5213], 14);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      zoneRef.current = [];
      initialCenterDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!point) {
      markerRef.current?.remove();
      markerRef.current = null;
      initialCenterDoneRef.current = false;
      return;
    }
    const latlng: L.LatLngExpression = [point.lat, point.lng];
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { icon: riderIcon(point.heading), keyboard: false, zIndexOffset: 500 }).addTo(map);
    } else {
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(riderIcon(point.heading));
    }
    if (!initialCenterDoneRef.current) {
      map.setView(latlng, Math.max(map.getZoom(), 15), { animate: false });
      initialCenterDoneRef.current = true;
    }
  }, [point]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    zoneRef.current.forEach((shape) => shape.remove());
    zoneRef.current = [];
    const geometry = deliveryZone?.geometry;
    if (!geometry) return;
    ringsOf(geometry)
      .filter((ring) => Array.isArray(ring) && ring.length > 2)
      .forEach((ring) => {
        const latlngs = ring.map(([lng, lat]) => [Number(lat), Number(lng)] as [number, number]);
        const shape = L.polygon(latlngs, { color: "#4b7f2a", weight: 2, fillColor: "#9be15d", fillOpacity: 0.12 }).addTo(map);
        zoneRef.current.push(shape);
      });
    if (zoneRef.current.length && !point) {
      const bounds = L.featureGroup(zoneRef.current).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [deliveryZone, point]);

  const centerOnRider = () => {
    if (!point || !mapRef.current) return;
    mapRef.current.setView([point.lat, point.lng], Math.max(mapRef.current.getZoom(), 16), { animate: true });
    markerRef.current?.openTooltip();
  };

  const accuracy = Number(point?.accuracy);
  const precision = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 500
    ? ` · precisión aproximada ±${Math.round(accuracy)} m`
    : " · precisión no disponible";
  const locationMessage = !point
    ? active
      ? "GPS activo · esperando la primera posición real de esta sesión"
      : "Activa la jornada para solicitar una posición GPS real; no se usa un centro predeterminado"
    : gps.state === "tracking"
      ? `GPS confirmado por la API${precision}`
      : `Posición GPS propia recibida; esperando confirmación de la API${precision}`;

  return <div className="rider-map-card">
    <div className="rider-map-status" aria-live="polite">{locationMessage}</div>
    {!point && <div className="rider-google-map-placeholder"><MapPin size={26} /><strong>Esperando tu GPS</strong><span>El mapa se habilita solo cuando esta sesión aporta una posición real.</span></div>}
    <div ref={nodeRef} className="rider-google-map-canvas" style={{ display: point ? undefined : "none", minHeight: 260 }} aria-label="Mapa de tu posición GPS y de la zona de reparto" />
    {point && <button type="button" className="rider-map-center" onClick={centerOnRider} aria-label="Centrar el mapa en mi ubicación" title="Centrar en mi ubicación"><LocateFixed size={19} /><span>Centrar</span></button>}
    {point && <a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`} target="_blank" rel="noreferrer"><Navigation size={16} /> Abrir mi posición en Google Maps</a>}
  </div>;
}
