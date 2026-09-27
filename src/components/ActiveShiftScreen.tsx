import { Banknote, Camera, ChevronDown, ChevronUp, ClipboardList, Menu, Navigation, Phone, RefreshCw, ShieldCheck, X } from "lucide-react";
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
  startedShiftNotice: boolean;
  toast: string;
  onDismissStartNotice: () => void;
  onOpenOperations: () => void;
  onRefreshOffers: () => void;
  onOfferAction: (orderId: string, action: "picked_up" | "on_the_way") => void;
  actionBusy?: boolean;
  onConfirmPickup: (orderId: string, verificationCode: string) => void;
  onConfirmDelivery: (orderId: string, deliveryQr: string) => void;
  onError: (message: string) => void;
};

function routeLabel(order: RiderOffer) {
  if (order.assignmentState === "offered") return "Nuevo pedido";
  if (order.status === "ready_for_pickup" || order.status === "preparing") return "Ve al establecimiento";
  if (order.status === "picked_up") return "Confirma el inicio de ruta";
  if (order.status === "on_the_way") return "Entrega en curso";
  return "Pedido asignado";
}

function formatPrice(cents?: number | null) {
  if (cents == null) return "";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

type RiderOrderItem = NonNullable<RiderOffer["items"]>[number];

function itemPrice(item: RiderOrderItem) {
  return formatPrice(item.priceCents ?? item.totalCents ?? item.unitPriceCents);
}

function productCount(order: RiderOffer) {
  return (order.items || []).reduce((total, item) => total + (item.quantity || 1), 0);
}

function OrderDetail({ order }: { order: RiderOffer }) {
  const [expanded, setExpanded] = useState(true);
  const items = order.items || [];
  const deliveryPhase = order.status === "picked_up" || order.status === "on_the_way";
  const address = deliveryPhase ? order.deliveryAddress || "Dirección del cliente protegida" : order.restaurant?.address || "Dirección del establecimiento protegida";

  return <section className="active-order-detail" aria-label="Detalle del pedido">
    <header className="active-order-header">
      <div>
        <h2>{deliveryPhase ? order.customerName || "Cliente final" : order.restaurant?.name || "Establecimiento PIKI"}</h2>
        <p>{productCount(order)} {productCount(order) === 1 ? "producto" : "productos"}</p>
      </div>
      {deliveryPhase ? order.customerPhone && <a className="active-call-button" href={`tel:${order.customerPhone}`} aria-label={`Llamar a ${order.customerName || "el cliente"}`}><Phone size={22}/></a> : order.restaurant?.phone && <a className="active-call-button" href={`tel:${order.restaurant.phone}`} aria-label={`Llamar a ${order.restaurant.name || "el establecimiento"}`}><Phone size={22}/></a>}
    </header>
    <p className="active-order-context">{deliveryPhase ? "ENTREGA AL CLIENTE" : "RECOGIDA EN ESTABLECIMIENTO"}</p>
    <p className="active-order-address">{address}</p>
    <button type="button" className="active-items-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <strong>{productCount(order)} {productCount(order) === 1 ? "producto" : "productos"}</strong>
      {expanded ? <ChevronUp size={23}/> : <ChevronDown size={23}/>}
    </button>
    {expanded && <div className="active-items-list">
      {items.length ? items.map((item, index) => <article className="active-item" key={`${item.name || "producto"}-${index}`}>
        <span className="active-item-quantity">{item.quantity || 1}</span>
        <div className="active-item-content">
          <div className="active-item-title"><strong>{item.name || "Producto"}</strong>{itemPrice(item) && <span>{itemPrice(item)}</span>}</div>
          {(item.modifiers || []).map((modifier, modifierIndex) => <div className="active-item-modifier" key={`${modifier.name}-${modifierIndex}`}>+ {modifier.quantity || 1} {modifier.name}{modifier.priceCents != null && <span>{formatPrice(modifier.priceCents)}</span>}</div>)}
        </div>
      </article>) : <p className="active-empty-items">El detalle de productos estará disponible al sincronizar el pedido.</p>}
    </div>}
    <div className="active-payment"><span>Pago</span><strong>{order.paymentMethod === "cash" ? "No pagar en el local" : order.paymentMethod === "bizum" ? "Bizum" : "Pago online"}</strong>{order.totalCents != null && <b>{formatPrice(order.totalCents)}</b>}</div>
  </section>;
}

export default function ActiveShiftScreen({ token, riderId, currentShift, offers, offersLoading, offersError, startedShiftNotice, toast, actionBusy = false, onDismissStartNotice, onOpenOperations, onRefreshOffers, onOfferAction, onConfirmPickup, onConfirmDelivery, onError }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"pickup" | "delivery">("delivery");
  const [scannerReady, setScannerReady] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopScanner = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setScannerReady(false); };
  useEffect(() => () => stopScanner(), []);
  const closeScanner = () => { stopScanner(); setScannerOpen(false); setQrValue(""); };
  const openScanner = (mode: "pickup" | "delivery") => { setScannerMode(mode); setQrValue(""); setScannerOpen(true); };
  const startScanner = async () => {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) { onError("Este dispositivo no permite abrir el lector QR. Pega el enlace QR del Customer."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream; setScannerReady(true); setScannerOpen(true);
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
  const pickupPhase = liveOrder && (liveOrder.status === "ready_for_pickup" || liveOrder.status === "preparing");

  return <main className="active-shift-shell" aria-label="Jornada activa PIKI Rider">
    <section className="active-map real-google-map-section">
      <LiveGoogleMap token={token} riderId={riderId} active onError={onError}/>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>{offersError ? "Sin GPS/API" : "En línea"}</strong><i className="online-dot"/></div>
      {startedShiftNotice && <section className="active-start-dialog" role="dialog" aria-modal="true" aria-label="Jornada iniciada">
        <div className="active-start-icon"><Navigation size={28}/></div><h1>El horario de conexión ha comenzado</h1><p>Revisa el mapa y mantén la app abierta para identificar zonas de demanda y recibir pedidos en tiempo real.</p><button type="button" onClick={onDismissStartNotice}>Entendido</button>
      </section>}

      <section className={`active-bottom-sheet ${liveOrder ? "has-live-order" : ""}`} aria-live="polite">
        {offersLoading ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Conectando con pedidos…</h1><p>Sincronizando tus ofertas y las zonas operativas de {subtitle}.</p></> : offersError ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Sin conexión temporal</h1><p>{offersError}. Tu jornada sigue activa; vuelve a sincronizar para recibir las ofertas pendientes.</p><button type="button" className="active-retry-button" onClick={onRefreshOffers}><RefreshCw size={16}/> Reintentar</button></> : liveOrder ? <>
          <p className="active-eyebrow">PIKI · {liveOrder.assignmentState === "assigned" ? "NUEVO PEDIDO ACEPTADO" : "NUEVO PEDIDO"}</p>
          <h1 className="active-route-title">{routeLabel(liveOrder)}</h1>
          <OrderDetail order={liveOrder}/>
          {pickupPhase && <button type="button" className="active-order-button" disabled={actionBusy} onClick={() => openScanner("pickup")}><ClipboardList size={17}/> Escanear QR del establecimiento</button>}
          {liveOrder.paymentMethod === "cash" && <p className="active-cash-note"><Banknote size={15}/> Cobrar en efectivo al cliente: {formatPrice(liveOrder.totalCents || 0)}</p>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <button type="button" className="active-order-button" disabled={actionBusy} onClick={() => onOfferAction(liveOrder._id, "on_the_way")}><Navigation size={17}/> Iniciar ruta</button>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "on_the_way" && <button type="button" className="active-order-button" onClick={() => openScanner("delivery")}><Camera size={17}/> Escanear QR o PIN del cliente</button>}
        </> : <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Buscando pedidos…</h1><p>Estás visible para la red PIKI en {subtitle}. Cuando llegue una oferta, sonará una alerta y aparecerá aquí sin refrescar.</p></>}
      </section>
      {scannerOpen && liveOrder && <section className="delivery-qr-dialog" role="dialog" aria-modal="true" aria-label={scannerMode === "pickup" ? "Autorizar recogida" : "Confirmar entrega"}><button type="button" className="delivery-qr-close" onClick={closeScanner} aria-label="Cerrar"><X size={18}/></button><p className="active-eyebrow">{scannerMode === "pickup" ? "RECOGIDA SEGURA" : "ENTREGA SEGURA"}</p><h2>{scannerMode === "pickup" ? "Escanea el QR del establecimiento" : "Escanea el QR o introduce el PIN del cliente"}</h2><p>{scannerMode === "pickup" ? "El establecimiento debe validar este pedido antes de entregártelo. Después podrás iniciar la ruta hacia el cliente." : "El customer te facilitará un QR o un PIN. Valídalo al entregarle el pedido para cerrar la entrega."}</p><video ref={videoRef} muted playsInline className={scannerReady ? "delivery-qr-video" : "hidden"}/>{!scannerReady && <button type="button" className="active-order-button" onClick={startScanner}><Camera size={17}/> Abrir cámara para escanear QR</button>}<label>{scannerMode === "pickup" ? "También puedes introducir el código de recogida" : "También puedes introducir el PIN o código QR"}<input value={qrValue} onChange={(event) => setQrValue(event.target.value)} placeholder={scannerMode === "pickup" ? "Código del establecimiento" : "PIN o enlace QR del customer"} autoComplete="one-time-code" /></label><button type="button" disabled={!qrValue.trim() || actionBusy} className="active-order-button" onClick={() => { if (scannerMode === "pickup") onConfirmPickup(liveOrder._id, qrValue.trim()); else onConfirmDelivery(liveOrder._id, qrValue.trim()); closeScanner(); }}><ShieldCheck size={17}/> {scannerMode === "pickup" ? "Autorizar recogida" : "Confirmar entrega"}</button></section>}
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
