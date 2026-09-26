import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchServedRiderRelease, requiresRiderUpdate, type ServedRelease } from "./pwa-release";

type Props = { children: React.ReactNode };
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const reloadMarkerPrefix = "piki-rider-release-reload:";

async function updateServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return;
  await registration.update();
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
}

export default function ReleaseUpdateGate({ children }: Props) {
  const [requiredRelease, setRequiredRelease] = useState<ServedRelease | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const checkingRef = useRef(false);

  const checkForRequiredRelease = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const release = await fetchServedRiderRelease();
      if (release && requiresRiderUpdate(release)) setRequiredRelease(release);
    } catch {
      // A transient release-file failure must not lock an already-operational rider out.
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkForRequiredRelease();
    const onFocus = () => { void checkForRequiredRelease(); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => { void checkForRequiredRelease(); }, CHECK_INTERVAL_MS);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [checkForRequiredRelease]);

  const updateNow = useCallback(async () => {
    if (!requiredRelease || updating) return;
    setUpdating(true);
    setUpdateError("");
    const version = requiredRelease.minimumVersion || requiredRelease.version || "required";
    const marker = `${reloadMarkerPrefix}${version}`;
    try {
      await updateServiceWorker();
      // The marker deliberately lives alongside, not instead of, the existing auth token.
      // It prevents an old shell from reloading indefinitely if a CDN has not yet served new assets.
      if (sessionStorage.getItem(marker)) {
        setUpdateError("La actualización todavía no está disponible en este dispositivo. Cierra y vuelve a abrir PIKI Riders en unos minutos.");
        return;
      }
      sessionStorage.setItem(marker, "1");
      window.location.reload();
    } catch {
      setUpdateError("No se pudo actualizar ahora. Comprueba la conexión y vuelve a intentarlo.");
    } finally {
      setUpdating(false);
    }
  }, [requiredRelease, updating]);

  if (!requiredRelease) return <>{children}</>;
  return <main className="release-update-backdrop" aria-live="assertive">
    <section className="release-update-dialog" role="dialog" aria-modal="true" aria-labelledby="release-update-title" aria-describedby="release-update-copy">
      <RefreshCw aria-hidden="true" size={30} />
      <p className="eyebrow">PIKI RIDERS · ACTUALIZACIÓN REQUERIDA</p>
      <h1 id="release-update-title">Actualiza PIKI Riders para continuar</h1>
      <p id="release-update-copy">Esta versión ya no puede utilizarse para la operativa. La actualización conserva tu sesión y los datos guardados en este dispositivo.</p>
      {updateError && <p className="form-error" role="alert">{updateError}</p>}
      <button className="primary-button" type="button" onClick={() => void updateNow()} disabled={updating}>
        <RefreshCw aria-hidden="true" size={17} className={updating ? "spin" : ""} />
        {updating ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </section>
  </main>;
}
