import { Clock3 } from "lucide-react";
import { useOfferCountdown } from "../useOfferCountdown";

type Props = { deadline?: string | null; serverNow?: string | null; mode?: "list" | "hero" };

export default function OfferCountdown({ deadline, serverNow, mode = "list" }: Props) {
  const seconds = useOfferCountdown(deadline, serverNow);
  const text = seconds === null ? "Plazo no disponible" : `${seconds} segundos para responder`;

  if (mode === "hero") {
    return <div className="exact-countdown" aria-label={text} title={seconds === null ? "El servidor no ha indicado el vencimiento" : undefined}>
      <b>{seconds ?? "—"}</b><span>seg</span>
    </div>;
  }

  return <span className="assignment-countdown" aria-label={text} title={seconds === null ? "El servidor no ha indicado el vencimiento" : undefined}>
    <Clock3 size={14} aria-hidden="true" /> {seconds === null ? "Plazo no disponible" : `${seconds} s`}
  </span>;
}
