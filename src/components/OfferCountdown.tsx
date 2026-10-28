import { useEffect, useState } from "react";
import { offerSecondsRemaining } from "../orderCountdown";

type Props = { expiresAt?: string | null };

export default function OfferCountdown({ expiresAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{offerSecondsRemaining(expiresAt, now)} s</>;
}
