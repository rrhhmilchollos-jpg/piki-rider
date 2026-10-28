import { LocateFixed, Volume2 } from "lucide-react";
import { useRiderGpsSnapshot } from "../riderGpsState";
import { startRiderDeviceGps } from "../riderGpsSession";

type Props = {
  active: boolean;
  playTestSound: () => Promise<void>;
};

export default function OperationalActivation({ active, playTestSound }: Props) {
  const gps = useRiderGpsSnapshot();

  async function handleAction() {
    await playTestSound();
    if (gps.state === "idle" || gps.state === "error") startRiderDeviceGps();
  }

  if (!active) return null;
  const confirmed = gps.state === "tracking";
  const waiting = gps.state === "starting" || gps.state === "waiting";
  const label = confirmed
    ? "Ubicación y sonido activados"
    : waiting
      ? "Esperando confirmación de ubicación"
      : gps.state === "error"
        ? "GPS requiere atención"
        : "GPS detenido";
  const actionLabel = waiting
    ? "GPS esperando confirmación"
    : gps.state === "error" || gps.state === "idle"
      ? "Reintentar GPS y sonido"
      : "Probar sonido";

  return <section className={`operational-activation activation-${gps.state}`} aria-live="polite">
    <div className="activation-icons"><LocateFixed size={20} /><Volume2 size={20} /></div>
    <div>
      <strong>{label}</strong>
      <p>{gps.detail}</p>
      <small>Durante la jornada, PIKI transmite tu ubicación GPS para coordinar repartos y mostrar su avance. Android mantiene una notificación mientras el servicio GPS sigue activo; se detiene al finalizar la jornada.</small>
    </div>
    <button className="primary-button" type="button" onClick={() => void handleAction()} disabled={waiting}>
      <LocateFixed size={16} />{actionLabel}
    </button>
  </section>;
}
