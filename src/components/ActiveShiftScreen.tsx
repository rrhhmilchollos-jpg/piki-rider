import { Camera, ChevronDown, ChevronUp, Menu, Navigation, Phone, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import LiveGoogleMap from "./LiveGoogleMap";
import SlideToConfirm from "./SlideToConfirm";
import type { CurrentShift, RiderOffer } from "../types/rider";
import {
  getRiderPaymentInstruction,
  isCustomerDeliveryPhase,
} from "../orderPaymentInstruction";
import { orderRiderQueue } from "../orderQueue";
import {
  buildDirectionsUrl,
  getRiderNavigationTarget,
} from "../orderNavigation";
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
  nativeTracking?: boolean;
  onDismissStartNotice: () => void;
  onOpenOperations: () => void;
  onRefreshOffers: () => void;
  onOfferAction: (orderId: string, action: "on_the_way") => void;
  onAcceptOffer: (orderId: string) => void;
  onConfirmArrival: (orderId: string) => void;
  actionBusy?: boolean;
  onConfirmPickup: (orderId: string, verificationCode: string) => void;
  onConfirmDelivery: (orderId: string, deliveryQr: string) => void;
  onError: (message: string) => void;
};

function routeLabel(order: RiderOffer) {
  if (order.assignmentState === "offered") return "Nueva oferta";
  if (!order.riderArrivedAt && ["pending", "accepted", "preparing", "ready_for_pickup"].includes(order.status)) return "Llega al establecimiento";
  if (order.riderArrivedAt && order.status !== "ready_for_pickup") return "Esperando preparación";
  if (order.status === "ready_for_pickup") return "Pedido listo para recoger";
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
  const deliveryPhase = isCustomerDeliveryPhase(order.status);
  const address = deliveryPhase ? order.deliveryAddress || "Dirección del cliente protegida" : order.restaurant?.address || "Dirección del establecimiento protegida";
  const paymentInstruction = getRiderPaymentInstruction(order);

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
    <div className="active-payment"><span>Pago</span><strong>{paymentInstruction.detail}</strong>{paymentInstruction.amountToCollectCents != null && <b>{formatPrice(paymentInstruction.amountToCollectCents)}</b>}</div>
  </section>;
}

export default function ActiveShiftScreen({ token, riderId, currentShift, offers, offersLoading, offersError, startedShiftNotice, toast, nativeTracking = false, actionBusy = false, onDismissStartNotice, onOpenOperations, onRefreshOffers, onOfferAction, onAcceptOffer, onConfirmArrival, onConfirmPickup, onConfirmDelivery, onError }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"pickup" | "delivery">("delivery");
  const [scannerReady, setScannerReady] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [sheetCollapsed, setSheetCollapsed] = useState(() => {
    try {
      return localStorage.getItem(`piki-${location.hostname}-rider-sheet-collapsed`) === "true";
    } catch {
      return false;
    }
  });
  const sheetDragStartYRef = useRef<number | null>(null);
  const suppressSheetClickRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopScanner = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setScannerReady(false); };
  useEffect(() => () => stopScanner(), []);
  const closeScanner = () => { stopScanner(); setScannerOpen(false); setQrValue(""); };
  const openScanner = (mode: "pickup" | "delivery", orderId?: string) => { setScannerMode(mode); setSelectedOrderId(orderId || null); setQrValue(""); setScannerOpen(true); };
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
  const assignedOrders = offers.filter((order) => order.assignmentState === "assigned");
  const liveOrders = orderRiderQueue(assignedOrders.length ? assignedOrders : offers.filter((order) => order.assignmentState === "offered"));
  const liveOrder = liveOrders[0];
  const selectedOrder = liveOrders.find((order) => order._id === selectedOrderId) || liveOrder;
  const navigation = liveOrder ? getRiderNavigationTarget(liveOrder) : null;
  const summaryName = liveOrder
    ? navigation?.phase === "customer"
      ? liveOrder.customerName || "Cliente final"
      : liveOrder.restaurant?.name || "Establecimiento Partner"
    : "";
  const subtitle = currentShift.shift?.zone ? `Zona ${currentShift.shift.zone}` : "Xàtiva";

  useEffect(() => {
    try {
      localStorage.setItem(`piki-${location.hostname}-rider-sheet-collapsed`, String(sheetCollapsed));
    } catch {
      // The sheet remains usable when persistent browser storage is unavailable.
    }
  }, [sheetCollapsed]);

  const handleSheetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    sheetDragStartYRef.current = event.clientY;
  };
  useEffect(() => {
    const finishSwipe = (event: PointerEvent) => {
      if (sheetDragStartYRef.current === null) return;
      const delta = event.clientY - sheetDragStartYRef.current;
      if (Math.abs(delta) > 40) {
        setSheetCollapsed(delta > 0);
        suppressSheetClickRef.current = true;
        window.setTimeout(() => { suppressSheetClickRef.current = false; }, 300);
      }
      sheetDragStartYRef.current = null;
    };
    document.addEventListener("pointerup", finishSwipe);
    document.addEventListener("pointercancel", finishSwipe);
    return () => {
      document.removeEventListener("pointerup", finishSwipe);
      document.removeEventListener("pointercancel", finishSwipe);
    };
  }, []);
  const toggleSheet = () => {
    if (suppressSheetClickRef.current) {
      suppressSheetClickRef.current = false;
      return;
    }
    setSheetCollapsed((value) => !value);
  };

  return <main className="active-shift-shell" aria-label="Jornada activa PIKI Rider">
    <section className="active-map real-google-map-section">
      <LiveGoogleMap token={token} riderId={riderId} active nativeTracking={nativeTracking} onError={onError}/>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>{offersError ? "Sin conexión" : "En línea"}</strong><i className="online-dot"/></div>
      {startedShiftNotice && <section className="active-start-dialog" role="dialog" aria-modal="true" aria-label="Jornada iniciada">
        <div className="active-start-icon"><Navigation size={28}/></div><h1>Turno activo. Tú conduces, PIKI coordina.</h1><p>{nativeTracking ? "El GPS nativo seguirá activo durante tu jornada, incluso al cerrar la app desde recientes." : "Mantén la app visible para recibir asignaciones y avisos en tiempo real."}</p><button type="button" onClick={onDismissStartNotice}>Entendido</button>
      </section>}

      <section className={`active-bottom-sheet ${liveOrder ? "has-live-order" : ""} ${sheetCollapsed && liveOrder ? "is-collapsed" : ""}`} aria-live="polite">
        {liveOrder && <button type="button" className="active-sheet-handle" aria-label={sheetCollapsed ? "Ampliar ficha del pedido" : "Minimizar ficha del pedido"} aria-expanded={!sheetCollapsed} onClick={toggleSheet} onPointerDown={handleSheetPointerDown}><span aria-hidden="true"/></button>}
        {liveOrder && navigation && <div className="active-order-summary" aria-hidden={!sheetCollapsed}><strong>{summaryName}</strong><p>{navigation.address}</p></div>}
        <div className="active-sheet-expanded-content" aria-hidden={Boolean(sheetCollapsed && liveOrder)}>
          {offersLoading && !liveOrder ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Conectando con pedidos…</h1><p>Sincronizando tus ofertas de reparto en {subtitle}.</p></> : offersError ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Sin conexión temporal</h1><p>{offersError}. Tu jornada sigue activa; vuelve a sincronizar para recibir las ofertas pendientes.</p><button type="button" className="active-retry-button" onClick={onRefreshOffers}><RefreshCw size={16}/> Reintentar</button></> : liveOrder ? <>
            <p className="active-eyebrow">PIKI · {liveOrders.length > 1 ? `${liveOrders.length} PEDIDOS ACTIVOS` : liveOrder.assignmentState === "assigned" ? "NUEVO PEDIDO ACEPTADO" : "NUEVO PEDIDO"}</p>
            <section className="active-order-stack-item" key={liveOrder._id} data-order-id={liveOrder.publicCode || liveOrder._id}><h1 className="active-route-title">{routeLabel(liveOrder)} · #{liveOrder.displayCode || liveOrder.publicCode || liveOrder._id.slice(-3)}</h1><OrderDetail order={liveOrder}/><button type="button" className="active-order-button active-gps-button" aria-label={`Abrir GPS hacia ${navigation?.phase === "partner" ? "el Partner" : "el cliente"}`} onClick={() => window.open(buildDirectionsUrl(navigation?.address || ""), "_blank", "noopener,noreferrer")}><Navigation size={17}/> {navigation?.label}</button>
              {liveOrder.assignmentState === "offered" && <SlideToConfirm label="Aceptar pedido y navegar" detail="Al aceptar, debes llegar al Partner en un máximo de 10 minutos." disabled={actionBusy} busy={actionBusy} onConfirm={() => onAcceptOffer(liveOrder._id)} />}
              {liveOrder.assignmentState === "assigned" && !liveOrder.riderArrivedAt && <SlideToConfirm label="Confirmar llegada al Partner" detail="PIKI verificará tu GPS cerca del establecimiento." disabled={actionBusy} busy={actionBusy} onConfirm={() => onConfirmArrival(liveOrder._id)} />}
              {liveOrder.assignmentState === "assigned" && Boolean(liveOrder.riderArrivedAt) && liveOrder.status !== "ready_for_pickup" && <p className="active-arrival-wait">Llegada verificada. El Partner tiene hasta 10 minutos para preparar el pedido.</p>}
              {liveOrder.assignmentState === "assigned" && Boolean(liveOrder.riderArrivedAt) && liveOrder.status === "ready_for_pickup" && <SlideToConfirm label="Confirmar recogida" detail="El pedido está listo y la llegada al Partner ya fue verificada." disabled={actionBusy} busy={actionBusy} onConfirm={() => onConfirmPickup(liveOrder._id, "")} />}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <SlideToConfirm label="Iniciar ruta al cliente" detail="Activa el seguimiento de entrega en tiempo real." disabled={actionBusy} busy={actionBusy} onConfirm={() => onOfferAction(liveOrder._id, "on_the_way")} />}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "on_the_way" && <button type="button" className="active-order-button" onClick={() => openScanner("delivery", liveOrder._id)}><Camera size={17}/> Escanear QR o PIN del cliente</button>}
              {liveOrders.length > 1 && <p className="active-pickup-pending">Hay {liveOrders.length - 1} pedido{liveOrders.length - 1 === 1 ? "" : "s"} más en cola. Se mostrará automáticamente cuando completes este.</p>}</section>
          </> : <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1 className="searching-orders-title">Buscando pedidos…</h1><p>Estás visible en {subtitle}. PIKI te avisará cuando haya una asignación; no necesitas refrescar.</p></>}
        </div>
      </section>
      {scannerOpen && selectedOrder && <section className="delivery-qr-dialog" role="dialog" aria-modal="true" aria-label={scannerMode === "pickup" ? "Autorizar recogida" : "Confirmar entrega"}><button type="button" className="delivery-qr-close" onClick={closeScanner} aria-label="Cerrar"><X size={18}/></button><p className="active-eyebrow">{scannerMode === "pickup" ? "RECOGIDA SEGURA · PEDIDO" : "ENTREGA SEGURA"}</p><h2>{scannerMode === "pickup" ? "Escanea el QR del pedido" : "Escanea el QR o introduce el PIN del cliente"}</h2><p>{scannerMode === "pickup" ? "El partner puede mostrar el QR o el PIN, pero no es obligatorio para continuar con la prueba." : "El Customer debe mostrarte el QR o decirte el PIN. Sin ese código no se puede confirmar ni cerrar la entrega."}</p><video ref={videoRef} muted playsInline className={scannerReady ? "delivery-qr-video" : "hidden"}/>{!scannerReady && <button type="button" className="active-order-button" onClick={startScanner}><Camera size={17}/> Abrir cámara para escanear QR</button>}<label>{scannerMode === "pickup" ? "PIN alfanumérico del pedido (opcional)" : "PIN o código QR obligatorio del Customer"}<input value={qrValue} maxLength={scannerMode === "pickup" ? 4 : undefined} onChange={(event) => setQrValue(event.target.value.toUpperCase())} placeholder={scannerMode === "pickup" ? "Opcional · Ej. 7KQ2" : "PIN o enlace QR del Customer"} autoComplete="one-time-code" /></label><button type="button" disabled={actionBusy || (scannerMode === "delivery" && !qrValue.trim())} className="active-order-button" onClick={() => { if (scannerMode === "pickup") { onConfirmPickup(selectedOrder._id, qrValue.trim()); } else onConfirmDelivery(selectedOrder._id, qrValue.trim()); closeScanner(); }}><ShieldCheck size={17}/> {scannerMode === "pickup" ? (qrValue.trim() ? "Autorizar recogida con QR/PIN" : "Confirmar recogida") : "Confirmar entrega con QR/PIN"}</button></section>}
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
