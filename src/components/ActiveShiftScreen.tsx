import { Banknote, Camera, CircleHelp, ClipboardList, Headphones, Menu, Navigation, Power, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LiveGoogleMap from "./LiveGoogleMap";
import type { CurrentShift, RiderOffer } from "../types/rider";
import "../ActiveShiftScreen.css";

type Props = {
  token: string;
  riderId: string;
  currentShift: CurrentShift;
  offers: RiderOffer[];
  offersLoading: boolean;
  offersError: string;
  shiftBusy: boolean;
  startedShiftNotice: boolean;
  toast: string;
  onStop: () => void;
  onDismissStartNotice: () => void;
  onOpenOperations: () => void;
  onSupport: () => void;
  onRefreshOffers: () => void;
  onOfferAction: (orderId: string, action: "accept" | "picked_up" | "on_the_way") => void;
  actionBusy?: boolean;
  onConfirmDelivery: (orderId: string, deliveryQr: string) => void;
  onError: (message: string) => void;
};

function routeLabel(order: RiderOffer) {
  if (order.assignmentState === "offered") return "Nueva oferta de reparto";
  if (order.status === "ready_for_pickup" || order.status === "preparing") return "Ve al establecimiento";
  if (order.status === "picked_up") return "Confirma el inicio de ruta";
  if (order.status === "on_the_way") return "Entrega en curso";
  return "Pedido asignado";
}

export default function ActiveShiftScreen({ token, riderId, currentShift, offers, offersLoading, offersError, shiftBusy, startedShiftNotice, toast, actionBusy = false, onStop, onDismissStartNotice, onOpenOperations, onSupport, onRefreshOffers, onOfferAction, onConfirmDelivery, onError }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopScanner = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  useEffect(() => () => stopScanner(), []);
  const closeScanner = () => { stopScanner(); setScannerOpen(false); setQrValue(""); };
  const startScanner = async () => {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) { onError("Este dispositivo no permite abrir el lector QR. Pega el enlace QR del Customer."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream; setScannerOpen(true);
      window.setTimeout(async () => {
        const video = videoRef.current; if (!video) return;
        video.srcObject = stream; await video.play(); const detector = new Detector({ formats: ["qr_code"] });
        const timer = window.setInterval(async () => { try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { setQrValue(codes[0].rawValue); window.clearInterval(timer); stopScanner(); } } catch {} }, 400);
      }, 0);
    } catch { onError("No se pudo abrir la cámara. Revisa el permiso o pega el enlace QR."); }
  };
  const offered = offers.find((order) => order.assignmentState === "offered");
  const assigned = offers.find((order) => order.assignmentState === "assigned");
  const liveOrder = offered || assigned;
  const subtitle = currentShift.shift?.zone ? `Zona ${currentShift.shift.zone}` : "Xàtiva";

  return <main className="active-shift-shell" aria-label="Jornada activa PIKI Rider">
    <section className="active-map real-google-map-section">
      <LiveGoogleMap token={token} riderId={riderId} active onError={onError}/>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>{offersError ? "Sin GPS/API" : "En línea"}</strong><i className="online-dot"/></div>
      <button type="button" className="active-help-button" onClick={onSupport} aria-label="Abrir soporte"><Headphones size={23}/></button>
      {startedShiftNotice && <section className="active-start-dialog" role="dialog" aria-modal="true" aria-label="Jornada iniciada">
        <div className="active-start-icon"><Navigation size={28}/></div>
        <h1>El horario de conexión ha comenzado</h1>
        <p>Revisa el mapa y mantén la app abierta para identificar zonas de demanda y recibir pedidos en tiempo real.</p>
        <button type="button" onClick={onDismissStartNotice}>Entendido</button>
      </section>}

      <section className="active-bottom-sheet" aria-live="polite">
        <p className="active-eyebrow">PIKI · JORNADA INICIADA</p>
        {offersLoading ? <>
          <h1>Conectando con pedidos…</h1>
          <p>Sincronizando tus ofertas y las zonas operativas de {subtitle}.</p>
        </> : offersError ? <>
          <h1>Sin conexión temporal</h1>
          <p>{offersError}. Tu jornada sigue activa; vuelve a sincronizar para recibir las ofertas pendientes.</p>
          <button type="button" className="active-retry-button" onClick={onRefreshOffers}><RefreshCw size={16}/> Reintentar</button>
        </> : liveOrder ? <>
          <h1>{routeLabel(liveOrder)}</h1>
          <p><strong>{liveOrder.restaurant?.name || "Establecimiento PIKI"}</strong><br/>{liveOrder.assignmentState === "assigned" && (liveOrder.status === "picked_up" || liveOrder.status === "on_the_way") ? liveOrder.deliveryAddress || "Dirección de entrega disponible en operaciones" : liveOrder.restaurant?.address || "Dirección disponible en operaciones"}</p>
          {liveOrder.assignmentState === "offered" && <button type="button" className="active-order-button" disabled={actionBusy} onClick={() => onOfferAction(liveOrder._id, "accept")}><ClipboardList size={17}/> Aceptar reparto</button>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "ready_for_pickup" && <button type="button" className="active-order-button" disabled={actionBusy} onClick={() => onOfferAction(liveOrder._id, "picked_up")}><Navigation size={17}/> Confirmar recogida</button>}
          {liveOrder.paymentMethod === "cash" && <p className="active-cash-note"><Banknote size={15}/> Cobrar en efectivo al cliente: {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format((liveOrder.totalCents || 0) / 100)}</p>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <button type="button" className="active-order-button" disabled={actionBusy} onClick={() => onOfferAction(liveOrder._id, "on_the_way")}><Navigation size={17}/> Iniciar ruta</button>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "on_the_way" && <button type="button" className="active-order-button" onClick={() => { setScannerOpen(true); setQrValue(""); }}><Camera size={17}/> Escanear QR y confirmar</button>}
        </> : <>
          <h1>Buscando pedidos…</h1>
          <p>Estás visible para la red PIKI en {subtitle}. Cuando llegue una oferta, sonará una alerta y aparecerá aquí sin refrescar.</p>
        </>}
        <div className="active-sheet-actions">
          <button type="button" className="active-stop-button" disabled={shiftBusy || Boolean(liveOrder)} onClick={onStop}><Power size={16}/>{shiftBusy ? "Finalizando…" : "Finalizar jornada"}</button>
          <button type="button" className="active-support-button" onClick={onSupport}><CircleHelp size={16}/> Soporte</button>
        </div>
        {liveOrder && <p className="active-safety-note"><ShieldCheck size={15}/> Termina o comunica la incidencia antes de cerrar la jornada.</p>}
      </section>
      {scannerOpen && liveOrder && <section className="delivery-qr-dialog" role="dialog" aria-modal="true" aria-label="Confirmar entrega con QR"><button type="button" className="delivery-qr-close" onClick={closeScanner} aria-label="Cerrar"><X size={18}/></button><p className="active-eyebrow">ENTREGA SEGURA</p><h2>Escanea el QR del Customer</h2><p>El cobro en efectivo se anotará en tu cartera solo después de validar este QR y confirmar la entrega.</p><video ref={videoRef} muted playsInline className={streamRef.current ? "delivery-qr-video" : "hidden"}/>{!streamRef.current && <button type="button" className="active-order-button" onClick={startScanner}><Camera size={17}/> Abrir cámara</button>}<label>También puedes pegar el enlace QR<input value={qrValue} onChange={(event) => setQrValue(event.target.value)} placeholder="https://pikidelivery.com/?order_id=…" /></label><button type="button" disabled={!qrValue || actionBusy} className="active-order-button" onClick={() => { onConfirmDelivery(liveOrder._id, qrValue); closeScanner(); }}><ShieldCheck size={17}/> Confirmar entrega</button></section>}
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
