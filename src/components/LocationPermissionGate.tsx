import { useCallback, useState, type ReactNode } from "react";
import "./LocationPermissionGate.css";

type LocationState = "idle" | "checking" | "granted" | "denied" | "unavailable" | "unsupported";

export default function LocationPermissionGate({ appLabel, children }: { appLabel: string; children: ReactNode }) {
  const [state, setState] = useState<LocationState>("idle");
  const [detail, setDetail] = useState("");

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState("unsupported");
      setDetail("Este navegador no ofrece geolocalización. Puedes entrar en PIKI; las funciones Rider que necesitan GPS te avisarán cuando las uses.");
      return;
    }
    setState("checking");
    setDetail("");
    navigator.geolocation.getCurrentPosition(
      () => { setDetail(""); setState("granted"); },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setState("denied");
          setDetail("Permite la ubicación para este sitio en los ajustes del navegador y activa la ubicación del teléfono. Después vuelve a intentarlo.");
        } else {
          setState("unavailable");
          setDetail("No se recibió una posición. Comprueba que el GPS del teléfono esté activo y vuelve a intentarlo.");
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  if (state === "granted") return <>{children}</>;
  return <>
    <aside className="location-permission-assist" role={state === "denied" || state === "unavailable" || state === "unsupported" ? "status" : "region"} aria-live="polite">
      <div className="location-permission-assist-copy">
        <strong>{state === "checking" ? "Comprobando ubicación…" : state === "denied" ? "Permiso de ubicación bloqueado" : state === "unavailable" ? "No se pudo obtener el GPS" : state === "unsupported" ? "Ubicación no disponible" : `PIKI ${appLabel}: ubicación opcional`}</strong>
        <span>{detail || "Puedes acceder a PIKI Rider sin GPS. Activa la ubicación para iniciar una jornada y compartir tu posición."}</span>
      </div>
      <button type="button" onClick={requestLocation} disabled={state === "checking"}>{state === "checking" ? "Esperando GPS…" : state === "denied" ? "Volver a intentar" : "Activar ubicación"}</button>
    </aside>
    {children}
  </>;
}
