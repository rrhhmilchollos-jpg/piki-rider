import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, CallbackError, Location } from "@capacitor-community/background-geolocation";
import { useEffect, useRef, useState } from "react";
import { LocateFixed, Volume2 } from "lucide-react";
import { publishRiderLocation } from "../integrations/piki-api";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

type Props = {
  token: string;
  riderId: string;
  active: boolean;
  playTestSound: () => Promise<void>;
  onError: (message: string) => void;
};

type ActivationState = "idle" | "starting" | "active" | "error";
type WatchReference = { kind: "native"; id: string } | { kind: "web"; id: number } | null;

function locationErrorMessage(error: CallbackError | GeolocationPositionError) {
  const code = String(error.code ?? "");
  if (code === "1" || code === "NOT_AUTHORIZED") return "No has autorizado la ubicación. Permite a PIKI Riders usarla durante la jornada.";
  if (code === "2") return "No se puede obtener una señal GPS ahora mismo.";
  return "La ubicación ha tardado demasiado. Comprueba el GPS y vuelve a intentarlo.";
}

export default function OperationalActivation({ token, riderId, active, playTestSound, onError }: Props) {
  const watchRef = useRef<WatchReference>(null);
  const publishingRef = useRef(false);
  const [state, setState] = useState<ActivationState>("idle");
  const [detail, setDetail] = useState("Activa ubicación y sonido antes de recibir ofertas.");

  const stopWatching = () => {
    const watcher = watchRef.current;
    watchRef.current = null;
    if (watcher?.kind === "web" && navigator.geolocation) navigator.geolocation.clearWatch(watcher.id);
    if (watcher?.kind === "native") void BackgroundGeolocation.removeWatcher({ id: watcher.id }).catch(() => undefined);
    publishingRef.current = false;
  };

  useEffect(() => () => stopWatching(), []);
  useEffect(() => {
    if (active) return;
    stopWatching();
    // oxlint-disable-next-line react/set-state-in-effect
    setState("idle");
    setDetail("La publicación de ubicación se detiene al finalizar la jornada.");
  }, [active]);

  async function publish(latitude: number, longitude: number, accuracy: number) {
    if (publishingRef.current) return;
    publishingRef.current = true;
    try {
      await publishRiderLocation(token, riderId, { latitude, longitude, accuracy });
      setState("active");
      setDetail(`Ubicación GPS publicada · precisión ±${Math.round(accuracy)} m.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo publicar la ubicación.";
      setState("error"); setDetail(message); onError(message);
    } finally {
      publishingRef.current = false;
    }
  }

  function handleNativeLocation(location?: Location, error?: CallbackError) {
    if (error) {
      const message = locationErrorMessage(error);
      setState("error"); setDetail(message); onError(message);
      return;
    }
    if (location) void publish(location.latitude, location.longitude, location.accuracy);
  }

  async function activate() {
    if (!active || state === "starting") return;
    if (!Capacitor.isNativePlatform() && !navigator.geolocation) {
      const message = "Este dispositivo no ofrece geolocalización.";
      setState("error"); setDetail(message); onError(message);
      return;
    }
    stopWatching();
    setState("starting");
    setDetail("Activando sonido y esperando una posición GPS real…");
    try {
      // Called directly from the rider's click so browsers may resume audio honestly.
      await playTestSound();
      if (Capacitor.isNativePlatform()) {
        const id = await BackgroundGeolocation.addWatcher({
          backgroundMessage: "PIKI Riders comparte tu ubicación mientras estás conectado. Vuelve a la app para finalizar la jornada.",
          backgroundTitle: "PIKI Riders · jornada activa",
          requestPermissions: true,
          stale: false,
          distanceFilter: 25,
        }, handleNativeLocation);
        watchRef.current = { kind: "native", id };
        setState("active");
        setDetail("GPS nativo activado; esperando la primera posición. iOS puede actualizar con la pantalla bloqueada si permites acceso Siempre.");
        return;
      }
      const id = navigator.geolocation.watchPosition(
        (position) => void publish(position.coords.latitude, position.coords.longitude, position.coords.accuracy),
        (error) => {
          const message = locationErrorMessage(error);
          setState("error"); setDetail(message); onError(message);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
      watchRef.current = { kind: "web", id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo activar el sonido o iniciar el GPS.";
      setState("error"); setDetail(message); onError(message);
    }
  }

  if (!active) return null;
  return <section className={`operational-activation activation-${state}`} aria-live="polite">
    <div className="activation-icons"><LocateFixed size={20} /><Volume2 size={20} /></div>
    <div>
      <strong>{state === "active" ? "Ubicación y sonido activados" : "Activa ubicación y sonido"}</strong>
      <p>{detail}</p>
      <small>En iPhone, permite ubicación «Siempre» para el turno. iOS puede detener el rastreo si fuerzas el cierre de la app o revocas el permiso.</small>
    </div>
    <button className="primary-button" type="button" onClick={() => void activate()} disabled={state === "starting"}>
      <LocateFixed size={16} />{state === "starting" ? "Activando…" : state === "active" ? "Probar ubicación y sonido" : "Activar ubicación y sonido"}
    </button>
  </section>;
}
