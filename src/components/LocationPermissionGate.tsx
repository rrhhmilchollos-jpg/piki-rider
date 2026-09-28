import { useCallback, useEffect, useState, type ReactNode } from "react";

type PermissionState = "checking" | "required" | "granted" | "unsupported" | "denied";

export default function LocationPermissionGate({ appLabel, children }: { appLabel: string; children: ReactNode }) {
  const [state, setState] = useState<PermissionState>("checking");
  const [detail, setDetail] = useState("");

  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setState("unsupported");
      setDetail("Este dispositivo o navegador no ofrece geolocalización.");
      return;
    }
    setState("checking");
    setDetail("");
    try {
      const permission = await navigator.permissions?.query({ name: "geolocation" });
      if (permission?.state === "denied") {
        setState("denied");
        setDetail("Activa la ubicación para este sitio desde los ajustes del navegador y vuelve a intentarlo.");
        return;
      }
    } catch {
      // Algunos navegadores móviles no exponen Permissions API; usamos GPS real igualmente.
    }
    navigator.geolocation.getCurrentPosition(
      () => setState("granted"),
      (error) => {
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "required");
        setDetail(error.code === error.PERMISSION_DENIED ? "Activa la ubicación para este sitio desde los ajustes del navegador y vuelve a intentarlo." : "No se pudo obtener la posición. Comprueba que el GPS esté activo.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    // The effect only starts the device GPS check; state is updated by its async result.
    // oxlint-disable-next-line react/set-state-in-effect
    requestLocation();
    const onVisibility = () => { if (document.visibilityState === "visible") void requestLocation(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestLocation]);

  useEffect(() => {
    if (state !== "granted" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(() => {}, () => {}, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [state]);

  if (state === "granted") return <>{children}</>;
  const title = state === "checking" ? "Comprobando ubicación" : state === "unsupported" ? "Ubicación no disponible" : "Necesitamos tu ubicación";
  const message = state === "checking" ? "Permite el acceso a la ubicación para continuar." : state === "unsupported" ? "Usa HTTPS y un navegador compatible con la ubicación." : "La ubicación es obligatoria para acceder a la operación de PIKI desde este dispositivo.";
  return <main className="location-permission-gate" role="alert" aria-live="polite"><section className="location-permission-card"><div className="location-permission-icon" aria-hidden="true">⌖</div><p className="location-permission-eyebrow">PIKI · {appLabel.toUpperCase()}</p><h1>{title}</h1><p>{message}</p>{detail && <small>{detail}</small>}{state !== "unsupported" && <button type="button" onClick={requestLocation}>{state === "checking" ? "Solicitar permiso de ubicación" : "Permitir ubicación y continuar"}</button>}{state === "unsupported" && <button type="button" onClick={() => window.location.reload()}>Volver a comprobar</button>}</section></main>;
}
