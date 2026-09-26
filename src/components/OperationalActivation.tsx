import { useEffect, useRef, useState } from "react";
import { LocateFixed, Volume2 } from "lucide-react";
import { publishRiderLocation } from "../integrations/piki-api";

type Props = {
  token: string;
  riderId: string;
  active: boolean;
  playTestSound: () => Promise<void>;
  onError: (message: string) => void;
};

type ActivationState = "idle" | "starting" | "active" | "error";

function locationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return "No has autorizado la ubicación. Actívala para publicar tu posición durante la jornada.";
  if (error.code === error.POSITION_UNAVAILABLE) return "No se puede obtener una señal GPS ahora mismo.";
  return "La ubicación ha tardado demasiado. Comprueba el GPS y vuelve a intentarlo.";
}

export default function OperationalActivation({ token, riderId, active, playTestSound, onError }: Props) {
  const watchIdRef = useRef<number | null>(null);
  const publishingRef = useRef(false);
  const [state, setState] = useState<ActivationState>("idle");
  const [detail, setDetail] = useState("Activa ubicación y sonido antes de recibir ofertas.");

  const stopWatching = () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
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

  async function activate() {
    if (!active || state === "starting") return;
    if (!navigator.geolocation) {
      const message = "Este dispositivo no ofrece geolocalización.";
      setState("error"); setDetail(message); onError(message);
      return;
    }
    stopWatching();
    setState("starting");
    setDetail("Activando sonido y esperando una posición GPS real…");
    try {
      // This call occurs directly from the rider's click, which allows browsers to resume audio honestly.
      await playTestSound();
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          if (publishingRef.current) return;
          publishingRef.current = true;
          const accuracy = Math.round(position.coords.accuracy);
          try {
            await publishRiderLocation(token, riderId, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            });
            setState("active");
            setDetail(`Ubicación GPS publicada · precisión ±${accuracy} m.`);
          } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo publicar la ubicación.";
            setState("error"); setDetail(message); onError(message);
          } finally {
            publishingRef.current = false;
          }
        },
        (error) => {
          const message = locationErrorMessage(error);
          setState("error"); setDetail(message); onError(message);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo activar el sonido.";
      setState("error"); setDetail(message); onError(message);
    }
  }

  if (!active) return null;
  return <section className={`operational-activation activation-${state}`} aria-live="polite">
    <div className="activation-icons"><LocateFixed size={20} /><Volume2 size={20} /></div>
    <div>
      <strong>{state === "active" ? "Ubicación y sonido activados" : "Activa ubicación y sonido"}</strong>
      <p>{detail}</p>
      <small>La ubicación se publica mediante GPS real mientras la jornada y esta página sigan activas. No se simula ubicación ni se promete avisos con la app cerrada.</small>
    </div>
    <button className="primary-button" type="button" onClick={() => void activate()} disabled={state === "starting"}>
      <LocateFixed size={16} />{state === "starting" ? "Activando…" : state === "active" ? "Probar ubicación y sonido" : "Activar ubicación y sonido"}
    </button>
  </section>;
}
