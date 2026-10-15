import { BellRing, Camera, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock3, Coins, Headphones, MapPin, Menu, Navigation, RefreshCw, ShieldCheck, ShoppingBag, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import LiveGoogleMap from "./LiveGoogleMap";
import SlideToConfirm from "./SlideToConfirm";
import type { CurrentShift, RiderOffer } from "../types/rider";
import { isCustomerDeliveryPhase } from "../orderPaymentInstruction";
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
  onOpenSupport: () => void;
  unreadMessageCount?: number;
  onRefreshOffers: () => void;
  onAcceptOffer: (orderId: string) => void;
  onOfferAction: (orderId: string, action: "on_the_way") => void;
  onConfirmArrival: (orderId: string) => void;
  actionBusy?: boolean;
  onConfirmPickup: (orderId: string, verificationCode: string) => void;
  onConfirmDelivery: (orderId: string, deliveryQr: string) => void;
  onError: (message: string) => void;
};

function formatPrice(cents?: number | null) {
  if (cents == null) return "";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function countdownSeconds(order: RiderOffer) {
  if (!order.assignmentExpiresAt) return 60;
  return Math.max(0, Math.ceil((new Date(order.assignmentExpiresAt).getTime() - Date.now()) / 1000));
}

function restaurantImage(order: RiderOffer) {
  return order.restaurant?.imageUrl || "";
}

function deliveryGain(order: RiderOffer) {
  return formatPrice(order.deliveryFeeCents) || "—";
}

function OrderItems({ order }: { order: RiderOffer }) {
  const [expanded, setExpanded] = useState(false);
  const items = order.items || [];
  return <>
    <button type="button" className="exact-items-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <strong>{items.length || 1} {items.length === 1 ? "producto" : "productos"}</strong>
      {expanded ? <ChevronUp size={19}/> : <ChevronDown size={19}/>}
    </button>
    {expanded && <div className="exact-items-list">{items.length ? items.map((item, index) => <div key={`${item.name || "producto"}-${index}`}><span>{item.quantity || 1}× {item.name || "Producto"}</span><b>{formatPrice(item.totalCents ?? item.priceCents)}</b></div>) : <span>Detalle pendiente de sincronización</span>}</div>}
  </>;
}

function IncomingOrderCard({ order }: { order: RiderOffer }) {
  const [seconds, setSeconds] = useState(() => countdownSeconds(order));
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(countdownSeconds(order)), 1000);
    return () => window.clearInterval(timer);
  }, [order]);
  const pickupMinutes = order.restaurant?.etaMinutes?.[0] ?? order.preparationMinutes ?? null;
  const deliveryMinutes = order.etaMinutes ?? null;
  return <div className="exact-card-content exact-incoming-card">
    <div className="exact-card-title-row"><div className="exact-alert-icon"><BellRing size={29}/></div><div><h2>NUEVO PEDIDO</h2><p>Un nuevo pedido te está esperando</p></div><div className="exact-countdown"><b>{seconds}</b><span>seg</span></div></div>
    <div className="exact-divider" />
    <div className="exact-restaurant-row">{restaurantImage(order) && <img src={restaurantImage(order)} alt="" aria-hidden="true"/>}<div><h3>{order.restaurant?.name || "Establecimiento Partner"}</h3><p>{order.restaurant?.address || "Dirección del Partner no disponible"}</p></div></div>
    <div className="exact-facts">
      <div><span className="exact-fact-icon yellow"><ShoppingBag size={24}/></span><p><b>Recogida · {pickupMinutes == null ? "—" : `${pickupMinutes} min`}</b><small>{order.status === "ready_for_pickup" ? "El pedido está listo" : "Preparación en curso"}</small></p></div>
      <div><span className="exact-fact-icon navy"><MapPin size={24}/></span><p><b>Entrega · {deliveryMinutes == null ? "—" : `${deliveryMinutes} min`}</b><small>{order.deliveryAddress || "Dirección de entrega no disponible"}</small></p></div>
      <div><span className="exact-fact-icon mint"><Coins size={24}/></span><p><b>{deliveryGain(order)} + propina</b><small>Ganancia estimada</small></p></div>
    </div>
    <div className="exact-ready"><CheckCircle2 size={25}/> <b>Preparado para recoger</b></div>
    <OrderItems order={order}/>
  </div>;
}

function ActiveOrderCard({ order }: { order: RiderOffer }) {
  const deliveryPhase = isCustomerDeliveryPhase(order.status);
  const customerName = order.customerName || "Cliente final";
  return <div className="exact-card-content exact-active-card">
    <div className="exact-active-label"><span>PEDIDO ACTIVO</span><span className="exact-bee-mark">●</span></div>
    <div className="exact-restaurant-row">{restaurantImage(order) && <img src={restaurantImage(order)} alt="" aria-hidden="true"/>}<div><h3>{deliveryPhase ? customerName : order.restaurant?.name || "Establecimiento Partner"}</h3><span className="exact-confirmed"><CheckCircle2 size={18}/> {order.status === "picked_up" || order.status === "on_the_way" ? "Recogida confirmada · ruta al cliente" : order.riderArrivedAt ? "Llegada confirmada" : "Pendiente de llegada"}</span></div></div>
    <div className="exact-active-facts">
      <div><UserRound size={28}/><span>Cliente: {customerName}</span></div>
            <div><MapPin size={28}/><span>{order.deliveryAddress || "Dirección de entrega no disponible"}</span></div>
      {deliveryPhase && order.deliveryNote && <div><ClipboardList size={28}/><span>Nota: {order.deliveryNote}</span></div>}
      <div><Clock3 size={28}/><span>Entrega estimada <b>{order.etaMinutes == null ? "—" : `${order.etaMinutes} min`}</b></span></div>
      <div><Coins size={28}/><span>{order.paymentMethod === "cash" ? <>Cobro al entregar: <b>{formatPrice(order.totalCents) || "Importe no disponible"}</b></> : <>Cobro al entregar: <b>Pagado online</b></>}</span></div>
    </div>
    <div className="exact-progress" aria-label="Progreso del pedido"><span className="done"><i>✓</i><b>Recoger</b></span><span className={order.status === "picked_up" || deliveryPhase ? "current" : ""}><i>○</i><b>En camino</b></span><span className={order.status === "on_the_way" ? "current" : ""}><i>○</i><b>Entregado</b></span></div>
    <OrderItems order={order}/>
  </div>;
}

export default function ActiveShiftScreen({ token, riderId, currentShift, offers, offersLoading, offersError, startedShiftNotice, toast, nativeTracking = false, actionBusy = false, onDismissStartNotice, onOpenOperations, onOpenSupport, unreadMessageCount = 0, onRefreshOffers, onAcceptOffer, onOfferAction, onConfirmArrival, onConfirmPickup, onConfirmDelivery, onError }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"pickup" | "delivery">("delivery");
  const [scannerReady, setScannerReady] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [newOrderNoticeOpen, setNewOrderNoticeOpen] = useState(false);
  const lastSeenOrderIdRef = useRef<string | null>(null);
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
    if (!liveOrder || lastSeenOrderIdRef.current === liveOrder._id) return;
    lastSeenOrderIdRef.current = liveOrder._id;
    setNewOrderNoticeOpen(true);
  }, [liveOrder]);

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
      <header className="active-brand-header" aria-label="PIKI Rider">
        <strong>PIKI <em>Rider</em></strong>
      </header>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <button type="button" className="active-help-button active-help-message-button" onClick={onOpenSupport} aria-label={unreadMessageCount ? `Abrir mensajes y soporte: ${unreadMessageCount} sin leer` : "Abrir soporte"}><Headphones size={24}/>{unreadMessageCount > 0 && <b className="active-message-badge" aria-hidden="true">{unreadMessageCount > 9 ? "9+" : unreadMessageCount}</b>}</button>
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>{offersError ? "Sin conexión" : "En línea"}</strong><i className="online-dot"/></div>
      {startedShiftNotice && <section className="active-start-dialog" role="dialog" aria-modal="true" aria-label="Jornada iniciada">
        <div className="active-start-icon"><Navigation size={28}/></div><h1>Turno activo. Tú conduces, PIKI coordina.</h1><p>{nativeTracking ? "El GPS nativo seguirá activo durante tu jornada, incluso al cerrar la app desde recientes." : "Mantén la app visible para recibir asignaciones y avisos en tiempo real."}</p><button type="button" onClick={onDismissStartNotice}>Entendido</button>
      </section>}
      {newOrderNoticeOpen && liveOrder && <section className="active-new-order-dialog" role="dialog" aria-modal="true" aria-label="Nuevo pedido asignado">
        <div className="active-new-order-icon"><ShoppingBag size={34}/></div><h1>{liveOrder.assignmentState === "assigned" ? "Nuevo pedido aceptado" : "Nueva asignación"}</h1><p>{liveOrder.restaurant?.name || "Establecimiento Partner"}</p><strong>{liveOrder.assignmentState === "assigned" ? "Dirígete al Partner para recogerlo" : "Revisa la dirección y acepta el pedido"}</strong><button type="button" onClick={() => { setNewOrderNoticeOpen(false); setSheetCollapsed(false); }}>Ver pedido</button>
      </section>}

      <section className={`active-bottom-sheet ${liveOrder ? "has-live-order" : ""} ${sheetCollapsed && liveOrder ? "is-collapsed" : ""}`} aria-live="polite">
        {liveOrder && <button type="button" className="active-sheet-handle" aria-label={sheetCollapsed ? "Ampliar ficha del pedido" : "Minimizar ficha del pedido"} aria-expanded={!sheetCollapsed} onClick={toggleSheet} onPointerDown={handleSheetPointerDown}><span aria-hidden="true"/></button>}
        {liveOrder && navigation && <div className="active-order-summary"><strong>{summaryName}</strong><p>{navigation.address}</p></div>}
        <div className="active-sheet-expanded-content" aria-hidden={Boolean(sheetCollapsed && liveOrder)}>
          {offersLoading && !liveOrder ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Conectando con pedidos…</h1><p>Sincronizando tus ofertas de reparto en {subtitle}.</p></> : offersError ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Sin conexión temporal</h1><p>{offersError}. Tu jornada sigue activa; vuelve a sincronizar para recibir las ofertas pendientes.</p><button type="button" className="active-retry-button" onClick={onRefreshOffers}><RefreshCw size={16}/> Reintentar</button></> : liveOrder ? <>
            <p className="active-eyebrow">PIKI · {liveOrders.length === 1 ? "1 PEDIDO ACTIVO" : `${liveOrders.length} PEDIDOS ACTIVOS`}</p>
            <section className={`active-order-stack-item ${navigation?.phase === "customer" ? "phase-customer" : "phase-partner"} ${liveOrder.assignmentState === "offered" ? "is-offered" : "is-assigned"}`} key={liveOrder._id} data-order-id={liveOrder.publicCode || liveOrder._id}>{liveOrder.assignmentState === "offered" ? <IncomingOrderCard order={liveOrder}/> : <ActiveOrderCard order={liveOrder}/>}<button type="button" className="active-order-button active-gps-button" aria-label={`Abrir GPS hacia ${navigation?.phase === "partner" ? "el Partner" : "el cliente"}`} onClick={() => window.open(buildDirectionsUrl(navigation?.address || ""), "_blank", "noopener,noreferrer")}><Navigation size={17}/> {navigation?.label}</button>
              {liveOrder.assignmentState === "offered" && <><p className="active-assignment-note">Este pedido debe aceptarse, recogerse en el Partner y entregarse al cliente final. PIKI verificará cada paso con GPS y QR/PIN.</p><button type="button" className="active-order-button exact-accept-button" disabled={actionBusy} onClick={() => onAcceptOffer(liveOrder._id)}>ACEPTAR PEDIDO</button></>}
              {liveOrder.assignmentState === "assigned" && !liveOrder.riderArrivedAt && <SlideToConfirm label="Confirmar llegada al Partner" detail="PIKI verificará tu GPS cerca del establecimiento." disabled={actionBusy} busy={actionBusy} onConfirm={() => onConfirmArrival(liveOrder._id)} />}
              {liveOrder.assignmentState === "assigned" && Boolean(liveOrder.riderArrivedAt) && liveOrder.status !== "ready_for_pickup" && <p className="active-arrival-wait">Llegada verificada. El Partner tiene hasta 15 minutos para preparar el pedido.</p>}
              {liveOrder.assignmentState === "assigned" && Boolean(liveOrder.riderArrivedAt) && liveOrder.status === "ready_for_pickup" && <button type="button" className="active-order-button active-qr-button" onClick={() => openScanner("pickup", liveOrder._id)}><Camera size={17}/> Escanear QR o PIN del Partner para recoger</button>}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <SlideToConfirm label="Iniciar ruta al cliente" detail="Activa el seguimiento de entrega en tiempo real." disabled={actionBusy} busy={actionBusy} onConfirm={() => onOfferAction(liveOrder._id, "on_the_way")} />}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "on_the_way" && <><SlideToConfirm compact label="Desliza para confirmar llegada" detail="Desliza cuando estés en la dirección del cliente." disabled={actionBusy} busy={actionBusy} onConfirm={() => openScanner("delivery", liveOrder._id)} /><button type="button" className="active-order-button active-qr-button" onClick={() => openScanner("delivery", liveOrder._id)}><Camera size={17}/> Escanear QR o PIN del cliente</button></>}
              {liveOrders.length > 1 && <p className="active-pickup-pending">Hay {liveOrders.length - 1} pedido{liveOrders.length - 1 === 1 ? "" : "s"} más en cola. Se mostrará automáticamente cuando completes este.</p>}</section>
          </> : <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1 className="searching-orders-title">Buscando pedidos…</h1><p>Estás visible en {subtitle}. PIKI te avisará cuando haya una asignación; no necesitas refrescar.</p></>}
        </div>
      </section>
      {scannerOpen && selectedOrder && <section className="delivery-qr-dialog" role="dialog" aria-modal="true" aria-label={scannerMode === "pickup" ? "Autorizar recogida" : "Confirmar entrega"}><button type="button" className="delivery-qr-close" onClick={closeScanner} aria-label="Cerrar"><X size={18}/></button><p className="active-eyebrow">{scannerMode === "pickup" ? "RECOGIDA SEGURA · PEDIDO" : "ENTREGA SEGURA"}</p><h2>{scannerMode === "pickup" ? "Escanea el QR del Partner" : "Escanea el QR o introduce el PIN del cliente"}</h2><p>{scannerMode === "pickup" ? "El Partner debe mostrar el QR o facilitar el PIN. Es obligatorio para confirmar la recogida." : "El Customer debe mostrarte el QR o decirte el PIN. Es obligatorio para cerrar la entrega."}</p><video ref={videoRef} muted playsInline className={scannerReady ? "delivery-qr-video" : "hidden"}/>{!scannerReady && <button type="button" className="active-order-button" onClick={startScanner}><Camera size={17}/> Abrir cámara para escanear QR</button>}<label>{scannerMode === "pickup" ? "PIN o enlace QR obligatorio del Partner" : "PIN o enlace QR obligatorio del Customer"}<input value={qrValue} onChange={(event) => setQrValue(event.target.value.toUpperCase())} placeholder={scannerMode === "pickup" ? "PIN o enlace QR del Partner" : "PIN o enlace QR del Customer"} autoComplete="one-time-code" /></label><button type="button" disabled={actionBusy || !qrValue.trim()} className="active-order-button" onClick={() => { if (scannerMode === "pickup") { onConfirmPickup(selectedOrder._id, qrValue.trim()); } else onConfirmDelivery(selectedOrder._id, qrValue.trim()); closeScanner(); }}><ShieldCheck size={17}/> {scannerMode === "pickup" ? "Autorizar recogida con QR/PIN" : "Confirmar entrega con QR/PIN"}</button></section>}
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
