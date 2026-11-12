import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, MapPin, Navigation } from "lucide-react";
import { useRiderGpsMapPoint } from "../riderGpsState";
import { ringsOf, useDeliveryZone } from "../riderGeofence";
import { observeRiderMapLayout, observeRiderMapTiles, riderMapTileDetail, type RiderMapTileState } from "../riderMapLifecycle";

type Props = { active?: boolean; apiOrigin?: string; token?: string; riderId?: string };

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap";
const RIDER_ICON_SIZE = 56;

function riderIcon(heading?: number) {
  const hasHeading = typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading <= 360;
  return L.divIcon({
    className: "rider-heading-icon-wrap",
    iconSize: [RIDER_ICON_SIZE, RIDER_ICON_SIZE],
    iconAnchor: [RIDER_ICON_SIZE / 2, RIDER_ICON_SIZE / 2],
    html: `<div class="rider-heading-marker" aria-hidden="true">
      ${hasHeading ? `<span class="rider-heading-beam" style="transform: rotate(${heading}deg)"></span>` : ""}
      <span class="rider-heading-dot"><span></span></span>
    </div>`,
  });
}

/**
 * Mapa del rider con Leaflet y teselas de OpenStreetMap. La posición solo se
 * dibuja cuando procede del proveedor de ubicación del dispositivo. El navegador
 * puede estimarla sin un receptor GPS; el mapa no acredita ACK ni elegibilidad.
 */
export default function LiveGoogleMap({ active = false, apiOrigin = "", token = "", riderId = "" }: Props) {
  const deliveryZone = useDeliveryZone(apiOrigin, token, riderId);
  const point = useRiderGpsMapPoint();
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const zoneRef = useRef<L.Polygon[]>([]);
  const initialCenterDoneRef = useRef(false);
  const [tileState, setTileState] = useState<RiderMapTileState>("idle");

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, { zoomControl: true, attributionControl: true });
    const tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 });
    const stopTileEvents = observeRiderMapTiles(tiles, setTileState);
    tiles.addTo(map);
    const stopLayout = observeRiderMapLayout(nodeRef.current, map);
    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      window.clearTimeout(timer);
      stopLayout();
      stopTileEvents();
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
    map.invalidateSize();
    const latlng: L.LatLngExpression = [point.lat, point.lng];
    if (!initialCenterDoneRef.current) {
      const zoom = map.getZoom();
      map.setView(latlng, Number.isFinite(zoom) ? Math.max(zoom, 15) : 15, { animate: false });
      initialCenterDoneRef.current = true;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { icon: riderIcon(point.heading), keyboard: false, zIndexOffset: 500 }).addTo(map);
    } else {
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(riderIcon(point.heading));
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
      ? "Jornada activa · esperando la primera posición de este dispositivo"
      : "Activa la jornada para solicitar una posición del dispositivo; no se usa un centro predeterminado"
    : `Posición del dispositivo recibida${precision}. El mapa no acredita confirmación GPS reciente ni elegibilidad para asignaciones.`;
  const tileDetail = point ? riderMapTileDetail(tileState) : "";

  return <div className="rider-map-card">
    <div className="rider-map-status" aria-live="polite">{locationMessage}{tileDetail && <small> {tileDetail}</small>}</div>
    {!point && <div className="rider-google-map-placeholder"><MapPin size={26} /><strong>Esperando tu ubicación</strong><span>El mapa se habilita cuando esta sesión aporta una posición del dispositivo; en un navegador puede ser una estimación sin GPS.</span></div>}
    <div ref={nodeRef} className="rider-google-map-canvas" style={{ display: point ? undefined : "none", minHeight: 260 }} aria-label="Mapa de tu posición GPS y de la zona de reparto" />
    {point && <button type="button" className="rider-map-center" onClick={centerOnRider} aria-label="Centrar el mapa en mi ubicación" title="Centrar en mi ubicación"><LocateFixed size={19} /><span>Centrar</span></button>}
    {point && <a className="secondary-button rider-map-open" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`} target="_blank" rel="noreferrer"><Navigation size={16} /> Abrir mi posición en Google Maps</a>}
  </div>;
}
