import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Puerta de GPS de la app del rider.
 *
 * Sin ubicación no se puede repartir: el cliente no vería al rider y PIKI no
 * podría demostrar la entrega. Por eso, si el permiso no está concedido, la app
 * se queda en esta pantalla en lugar de dejar seguir a medias.
 */

type Estado = "comprobando" | "concedido" | "rechazado" | "no_soportado";

async function leerPermiso(): Promise<Estado> {
  // The signed Android container requests permission through the native GPS
  // plugin; the WebView permission must not block that native flow.
  if (Capacitor.isNativePlatform()) return "concedido";
  if (typeof navigator === "undefined" || !navigator.geolocation) return "no_soportado";
  if (!navigator.permissions?.query) return "concedido";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (status.state === "granted") return "concedido";
    if (status.state === "denied") return "rechazado";
    return "rechazado";
  } catch {
    return "concedido";
  }
}

export default function GpsRequiredGate({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>("comprobando");

  useEffect(() => {
    let vivo = true;
    void leerPermiso().then((valor) => { if (vivo) setEstado(valor); });
    return () => { vivo = false; };
  }, []);

  const pedir = () => {
    navigator.geolocation.getCurrentPosition(
      () => setEstado("concedido"),
      () => setEstado("rechazado"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  if (estado === "comprobando" || estado === "concedido" || estado === "no_soportado") return <>{children}</>;

  return (
    <div className="gps-gate" role="alertdialog" aria-modal="true">
      <div className="gps-gate-card">
        <span aria-hidden className="gps-gate-icon">📍</span>
        <h1>Activa tu ubicación para repartir</h1>
        <p>
          PIKI necesita tu GPS mientras llevas un pedido: así el cliente ve dónde estás y la entrega
          queda registrada. Sin ubicación no podemos asignarte pedidos.
        </p>
        <button type="button" className="primary-button" onClick={pedir}>
          Permitir ubicación
        </button>
        <p className="gps-gate-help">
          En la PWA: Chrome → Configuración de sitios → Ubicación → rider.pikidelivery.com → Permitir.
          En el APK: Ajustes → Aplicaciones → PIKI Riders → Permisos → Ubicación → «Permitir siempre» y
          «Ubicación precisa».
        </p>
      </div>
    </div>
  );
}
