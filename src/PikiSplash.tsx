import { useEffect, useState, type ReactNode } from "react";

type Props = { children: ReactNode };

/** Shows the PIKI brand before mounting the app, login, or home route. */
export default function PikiSplash({ children }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return <>{children}</>;

  return (
    <main
      aria-label="PIKI Delivery"
      role="status"
      style={{
        alignItems: "center",
        background: "#ffd72e",
        display: "flex",
        flexDirection: "column",
        inset: 0,
        justifyContent: "center",
        minHeight: "100dvh",
        overflow: "hidden",
        position: "fixed",
        width: "100%",
        zIndex: 9999,
      }}
    >
      <img
        src="/piki-splash.webp"
        alt="PIKI Delivery"
        style={{ display: "block", height: "min(74dvh, 620px)", maxWidth: "92vw", objectFit: "contain", width: "min(92vw, 930px)" }}
      />
      <span style={{ color: "#172238", fontFamily: "Arial, sans-serif", fontSize: "clamp(18px, 3vw, 28px)", fontWeight: 800, letterSpacing: "0.12em", marginTop: "-2dvh", textTransform: "uppercase" }}>Pikidelivery.com</span>
    </main>
  );
}
