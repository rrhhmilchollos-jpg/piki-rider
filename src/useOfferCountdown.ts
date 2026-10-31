import { useEffect, useState } from "react";
import { assignmentCountdownSeconds } from "./offerCountdown";

export function useOfferCountdown(deadline?: string | null, serverNow?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const serverAnchor = serverNow ? Date.parse(serverNow) : Number.NaN;
    const wallClockAnchor = Number.isFinite(serverAnchor) ? serverAnchor : Date.now();
    const monotonicAnchor = performance.now();
    const update = () => setNow(wallClockAnchor + performance.now() - monotonicAnchor);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return assignmentCountdownSeconds(deadline, now);
}
