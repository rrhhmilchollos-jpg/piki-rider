import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import { useRiderGpsMapPoint } from "./riderGpsState";
import { pointInGeometry as sharedPointInGeometry, useDeliveryZone } from "./riderGeofence";

type CheckResult = {
  inside: boolean;
  distanceMeters: number;
  action: "none" | "warn" | "exception" | "sanction";
  strikes: number;
  message: string;
};

type Props = {
  apiOrigin: string;
  token: string;
  riderId: string;
  /** Solo se vigila durante la jornada. */
  active: boolean;
  /** Con un pedido en curso no se sanciona. */
  delivering: boolean;
};

/**
 * Avisa al rider cuando sale de su zona de reparto y registra el aviso en el
 * servidor. Con un pedido en curso no cuenta: puede ir a cualquier dirección.
 */
export default function GeofenceGuard({ apiOrigin, token, riderId, active, delivering }: Props) {
  const point = useRiderGpsMapPoint();
  const zone = useDeliveryZone(apiOrigin, token, riderId);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [outsideSince, setOutsideSince] = useState<number | null>(null);
  const lastCheckRef = useRef(0);
  const notifiedRef = useRef(false);

  const localInside = useMemo(() => {
    if (!zone?.geometry || !point) return true;
    return sharedPointInGeometry(point.lat, point.lng, zone.geometry);
  }, [zone, point]);

  useEffect(() => {
    if (!active || !point) {
      setOutsideSince(null);
      return;
    }
    if (localInside) {
      setOutsideSince(null);
      notifiedRef.current = false;
      if (result && !result.inside) setResult(null);
      return;
    }
    setOutsideSince((current) => current ?? Date.now());
  }, [active, localInside, point, result]);

  useEffect(() => {
    if (!active || !point || !zone?.geometry || localInside) return;
    const graceMs = (zone.graceMinutes ?? 5) * 60_000;
    if (!outsideSince || Date.now() - outsideSince < graceMs) return;
    if (Date.now() - lastCheckRef.current < 60_000) return;
    lastCheckRef.current = Date.now();
    (async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/riders/${riderId}/geofence-check`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: point.lat, longitude: point.lng, accuracy: point.accuracy }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as CheckResult;
        setResult(payload);
        if (!payload.inside && !notifiedRef.current && typeof Notification !== "undefined") {
          notifiedRef.current = true;
          if (Notification.permission === "granted") {
            new Notification("Fuera de la zona de reparto", {
              body: payload.message,
              tag: "piki-geofence",
            });
          } else if (Notification.permission !== "denied") {
            void Notification.requestPermission().then((permission) => {
              if (permission === "granted") new Notification("Fuera de la zona de reparto", { body: payload.message, tag: "piki-geofence" });
            });
          }
        }
      } catch {
        /* un fallo de red no debe bloquear la jornada */
      }
    })();
  }, [active, apiOrigin, localInside, outsideSince, point, riderId, token, zone]);

  if (!active || !zone?.geometry || localInside) return null;

  const sanctioned = result?.action === "sanction";
  const exception = delivering || result?.action === "exception";

  return (
    <div className={`geofence-banner ${sanctioned ? "geofence-banner-danger" : exception ? "geofence-banner-info" : "geofence-banner-warning"}`} role="alert">
      <AlertTriangle size={20} />
      <div>
        <strong>{sanctioned ? "Cuenta suspendida por salir de zona" : exception ? "Fuera de zona · pedido en curso" : "Estás fuera de la zona de reparto"}</strong>
        <span>
          {exception
            ? "Llevas un pedido encima: termínalo y vuelve a Xàtiva. Este trayecto no cuenta como aviso."
            : `${result?.message ?? "Vuelve a la zona para poder recibir pedidos."}${result?.strikes ? ` · Aviso ${result.strikes} de ${zone.strikeLimit}` : ""}`}
        </span>
      </div>
      <a className="geofence-banner-link" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point?.lat ?? ""},${point?.lng ?? ""}`)}`} target="_blank" rel="noreferrer">
        <MapPin size={14} /> Volver
      </a>
    </div>
  );
}
