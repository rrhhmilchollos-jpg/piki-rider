import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { assignmentCountdownSeconds } from "../offerCountdown";

type Props = { deadline?: string | null; mode?: "list" | "hero" };

export default function OfferCountdown({ deadline, mode = "list" }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = assignmentCountdownSeconds(deadline, now);
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
