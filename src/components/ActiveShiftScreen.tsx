import { BellRing, Camera, CheckCircle2, ClipboardList, Clock3, Coins, Headphones, MapPin, Menu, MessageCircle, Minus, Navigation, Phone, Plus, RefreshCw, ShieldCheck, ShoppingBag, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import LiveGoogleMap from "./LiveGoogleMap";
import type { CurrentShift, RiderOffer } from "../types/rider";
import { isCustomerDeliveryPhase } from "../orderPaymentInstruction";
import { orderRiderQueue } from "../orderQueue";
import OfferCountdown from "./OfferCountdown";
import {
  buildDirectionsUrl,
  getRiderNavigationTarget,
} from "../orderNavigation";
import "../ActiveShiftScreen.css";
import "../rider-card-payment-delay.css";

type Props = {
  currentShift: CurrentShift;
  offers: RiderOffer[];
  offersLoading: boolean;
  offersError: string;
  startedShiftNotice: boolean;
  toast: string;
  onDismissStartNotice: () => void;
  onOpenOperations: () => void;
  onCallSupport: () => void;
  onOpenSupport: () => void;
  onOpenOrderChat: (order: RiderOffer) => void;
  unreadMessageCount?: number;
  onRefreshOffers: () => void;
  onAcceptOffer: (orderId: string) => void;
  onOfferAction: (orderId: string, action: "on_the_way") => void;
  actionBusy?: boolean;
  onConfirmPickup: (orderId: string, verificationCode?: string) => void;
  onConfirmDelivery: (orderId: string, deliveryQr: string) => void;
  onError: (message: string) => void;
};

function formatPrice(cents?: number | null) {
  if (cents == null) return "";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function restaurantImage(order: RiderOffer) {
  return order.restaurant?.imageUrl || "";
}

function deliveryGain(order: RiderOffer) {
  return formatPrice(order.deliveryFeeCents) || "—";
}

function OrderItems({ order }: { order: RiderOffer }) {
  const items = order.items || [];
  return <>
    <div className="exact-items-heading"><strong>Productos del pedido</strong><span>{items.length || 1} {items.length === 1 ? "producto" : "productos"}</span></div>
    <div className="exact-items-list exact-items-list-visible">{items.length ? items.map((item, index) => <div key={`${item.name || "producto"}-${index}`}><span><b>{item.quantity || 1}×</b> {item.name || "Producto"}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}</span><b>{formatPrice(item.totalCents ?? item.priceCents) || "—"}</b></div>) : <span>Detalle pendiente de sincronización</span>}</div>
  </>;
}

function IncomingOrderCard({ order }: { order: RiderOffer }) {
  const pickupMinutes = order.restaurant?.etaMinutes?.[0] ?? order.preparationMinutes ?? null;
  const deliveryMinutes = order.etaMinutes ?? null;
  return <div className="exact-card-content exact-incoming-card">
    <div className="exact-card-title-row"><div className="exact-alert-icon"><BellRing size={29}/></div><div><h2>NUEVO PEDIDO</h2><p>Un nuevo pedido te está esperando</p></div><OfferCountdown deadline={order.assignmentExpiresAt} mode="hero" /></div>
    <div className="exact-divider" />
    <div className="exact-restaurant-row">{restaurantImage(order) && <img src={restaurantImage(order)} alt="" aria-hidden="true"/>}<div><h3>{order.restaurant?.name || "Establecimiento Partner"}</h3><p>{order.restaurant?.address || "Dirección del Partner no disponible"}</p></div></div>
    <div className="exact-facts">
      <div><span className="exact-fact-icon yellow"><ShoppingBag size={24}/></span><p><b>Recogida · {pickupMinutes == null ? "—" : `${pickupMinutes} min`}</b><small>{order.status === "ready_for_pickup" ? "El pedido está listo" : "Preparación en curso"}</small></p></div>
      <div><span className="exact-fact-icon navy"><MapPin size={24}/></span><p><b>Entrega · {deliveryMinutes == null ? "—" : `${deliveryMinutes} min`}</b><small>{order.deliveryAddress || "Dirección de entrega no disponible"}</small></p></div>
      <div><span className="exact-fact-icon mint"><Coins size={24}/></span><p><b>{deliveryGain(order)}</b><small>Ganancia estimada</small></p></div>
    </div>
    <div className="exact-ready"><CheckCircle2 size={25}/> <b>Preparado para recoger</b></div>
    <OrderItems order={order}/>
  </div>;
}

function PickupDeadlineFact({ deadline }: { deadline?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const deadlineMs = deadline ? new Date(deadline).getTime() : Number.NaN;
  const delayedMinutes = Number.isFinite(deadlineMs) ? Math.max(0, Math.floor((now - deadlineMs) / 60_000) + 1) : 0;
  const remainingMinutes = Number.isFinite(deadlineMs) ? Math.max(0, Math.ceil((deadlineMs - now) / 60_000)) : null;
  const delayed = delayedMinutes > 0;
  return <div className={`exact-pickup-deadline ${delayed ? "is-delayed" : ""}`}>
    <Clock3 size={28}/><span><b>{delayed ? "RETRASO EN RECOGIDA" : "PEDIDO LISTO PARA RETIRAR"}</b><strong>{delayed ? `+${delayedMinutes} min · reasignación automática en curso` : remainingMinutes == null ? "Confirma el retiro dentro de una manzana" : `${remainingMinutes} min para confirmar el retiro`}</strong></span>
  </div>;
}

function ActiveOrderCard({ order }: { order: RiderOffer }) {
  const deliveryPhase = isCustomerDeliveryPhase(order.status);
  const customerName = order.customerName || "Cliente final";
  return <div className="exact-card-content exact-active-card">
    <div className="exact-active-label"><span>{deliveryPhase ? "ENTREGA AL CLIENTE" : "RECOGIDA EN PARTNER"}<small>Pedido #{order.displayCode || order.publicCode || order._id.slice(-6).toUpperCase()}</small></span><span className="exact-bee-mark">●</span></div>
    <div className="exact-restaurant-row">{!deliveryPhase && restaurantImage(order) && <img src={restaurantImage(order)} alt="" aria-hidden="true"/>}<div><h3>{deliveryPhase ? customerName : order.restaurant?.name || "Establecimiento Partner"}</h3><span className="exact-confirmed"><CheckCircle2 size={18}/> {deliveryPhase ? "Recogida confirmada · ruta al cliente" : "Recogida GPS disponible al estar dentro de una manzana"}</span></div></div>
    <div className="exact-active-facts">
      {deliveryPhase ? <>
        <div><UserRound size={28}/><span><b>Cliente</b>{customerName}</span></div>
        {order.customerPhone && <div><Headphones size={28}/><span><b>Teléfono</b><a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a></span></div>}
        <div><MapPin size={28}/><span><b>Dirección completa de entrega</b>{order.deliveryAddress || "Dirección de entrega no disponible"}</span></div>
        {order.deliveryNote && <div><ClipboardList size={28}/><span><b>Nota del cliente</b>{order.deliveryNote}</span></div>}
      </> : <>
        <div><MapPin size={28}/><span><b>Dirección de recogida</b>{order.restaurant?.address || "Dirección del Partner no disponible"}</span></div>
        {order.restaurant?.phone && <div><Headphones size={28}/><span><b>Teléfono del Partner</b><a href={`tel:${order.restaurant.phone}`}>{order.restaurant.phone}</a></span></div>}
        <div><Coins size={28}/><span><b>Pago en el establecimiento</b>{order.paymentMethod === "cash" ? "Efectivo autorizado para este pedido. El importe se mostrará al entregar al cliente." : "No tienes que pagar nada al establecimiento."}</span></div>
      </>}
      {!deliveryPhase && order.status !== "ready_for_pickup" && <div><Clock3 size={28}/><span><b>Estará listo en</b>{`${Math.min(10, Math.max(4, order.preparationMinutes ?? order.restaurant?.etaMinutes?.[0] ?? 4))} min`}</span></div>}
    </div>
    {!deliveryPhase && order.status === "ready_for_pickup" && <PickupDeadlineFact deadline={order.pickupDeadlineAt}/>}
    {deliveryPhase && (order.paymentMethod === "cash" ? <div className="exact-cash-due"><Coins size={30}/><span>COBRA AL CLIENTE</span><strong>{formatPrice(order.totalCents) || "Importe no disponible"}</strong><small>Contrarreembolso autorizado · confírmalo al entregar</small></div> : <div className="exact-online-paid"><CheckCircle2 size={22}/><span>PAGO ONLINE CONFIRMADO · NO COBRES AL CLIENTE</span></div>)}
    <div className="exact-progress" aria-label="Progreso del pedido"><span className="done"><i>✓</i><b>Recoger</b></span><span className={deliveryPhase ? "current" : ""}><i>○</i><b>En camino</b></span><span><i>○</i><b>Entregado</b></span></div>
    <OrderItems order={order}/>
  </div>;
}

export default function ActiveShiftScreen({ currentShift, offers, offersLoading, offersError, startedShiftNotice, toast, actionBusy = false, onDismissStartNotice, onOpenOperations, onCallSupport, onOpenSupport, onOpenOrderChat, unreadMessageCount = 0, onRefreshOffers, onAcceptOffer, onOfferAction, onConfirmPickup, onConfirmDelivery, onError }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
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
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerGenerationRef = useRef(0);
  const scannerStartingRef = useRef(false);
  const stopScanner = () => {
    scannerGenerationRef.current += 1;
    scannerStartingRef.current = false;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    scannerStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerReady(false);
  };
  useEffect(() => () => {
    scannerGenerationRef.current += 1;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    scannerStreamRef.current = null;
  }, []);
  const closeScanner = () => { stopScanner(); setScannerOpen(false); setQrValue(""); };
  const openScanner = (orderId?: string) => { setSelectedOrderId(orderId || null); setQrValue(""); setScannerOpen(true); };
  const startScanner = async () => {
    if (scannerStartingRef.current || scannerControlsRef.current) return;
    const generation = ++scannerGenerationRef.current;
    scannerStartingRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNAVAILABLE");
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (generation !== scannerGenerationRef.current || !videoRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (generation !== scannerGenerationRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      scannerStreamRef.current = stream;
      setScannerReady(true);
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 400 });
      const controls = await reader.decodeFromStream(
        stream,
        videoRef.current,
        (result, _error, scannerControls) => {
          if (generation !== scannerGenerationRef.current) { scannerControls.stop(); return; }
          if (result) {
            setQrValue(result.getText());
            scannerControls.stop();
            stopScanner();
          }
        },
      );
      if (generation !== scannerGenerationRef.current) controls.stop();
      else scannerControlsRef.current = controls;
    } catch {
      if (generation === scannerGenerationRef.current) {
        stopScanner();
        onError("No se pudo abrir la cámara. Revisa el permiso o introduce el PIN del cliente; basta con uno de los dos métodos.");
      }
    } finally {
      if (generation === scannerGenerationRef.current) scannerStartingRef.current = false;
    }
  };
  const assignedOrders = offers.filter((order) => order.assignmentState === "assigned");
  const liveOrders = orderRiderQueue(assignedOrders.length ? assignedOrders : offers.filter((order) => order.assignmentState === "offered"));
  const liveOrder = liveOrders[0];
  const selectedOrder = liveOrders.find((order) => order._id === selectedOrderId) || liveOrder;
  const navigation = liveOrder ? getRiderNavigationTarget(liveOrder) : null;
  const subtitle = currentShift.shift?.zone ? `Zona ${currentShift.shift.zone}` : "Xàtiva";

  useEffect(() => {
    if (!liveOrder || lastSeenOrderIdRef.current === liveOrder._id) return;
    lastSeenOrderIdRef.current = liveOrder._id;
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
      <LiveGoogleMap active />
      <header className="active-brand-header" aria-label="PIKI Rider">
        <strong>PIKI <em>Rider</em></strong>
      </header>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <button type="button" className="active-support-call-button" onClick={onCallSupport} aria-label="Llamada directa al soporte" title="Llamada directa al soporte"><Phone size={22}/></button>
      <button type="button" className="active-help-button active-help-message-button" onClick={onOpenSupport} aria-label={unreadMessageCount ? `Abrir mensajes y soporte: ${unreadMessageCount} sin leer` : "Abrir soporte"}><Headphones size={24}/>{unreadMessageCount > 0 && <b className="active-message-badge" aria-hidden="true">{unreadMessageCount > 9 ? "9+" : unreadMessageCount}</b>}</button>
      {liveOrder && <button type="button" className="active-chat-header-button" onClick={() => onOpenOrderChat(liveOrder)} aria-label="Abrir chat con el cliente" title="Chat con el cliente"><MessageCircle size={24}/></button>}
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>{offersError ? "Sin conexión" : "En línea"}</strong><i className="online-dot"/></div>
      {startedShiftNotice && <section className="active-start-dialog" role="dialog" aria-modal="true" aria-label="Jornada iniciada">
        <div className="active-start-icon"><Navigation size={28}/></div><h1>Turno activo. Tú conduces, PIKI coordina.</h1><p>Mantén la app visible para recibir asignaciones y avisos en tiempo real.</p><button type="button" onClick={onDismissStartNotice}>Entendido</button>
      </section>}


      <section className={`active-bottom-sheet ${liveOrder ? "has-live-order" : ""} ${sheetCollapsed && liveOrder ? "is-collapsed" : ""}`} aria-live="polite">
        {liveOrder && <button type="button" className="active-sheet-handle" aria-label={sheetCollapsed ? "Ampliar ficha del pedido" : "Minimizar ficha del pedido"} aria-expanded={!sheetCollapsed} title={sheetCollapsed ? "Ampliar pedido" : "Ocultar detalle y dejar el mapa visible"} onClick={toggleSheet} onPointerDown={handleSheetPointerDown}><span className="active-sheet-grab-bar" aria-hidden="true"/>{sheetCollapsed ? <Plus size={21} strokeWidth={3}/> : <Minus size={21} strokeWidth={3}/>}</button>}
        {liveOrder && <div className="active-order-summary"><span className="active-order-summary-label"><i aria-hidden="true"/> PEDIDO #{liveOrder.displayCode || liveOrder.publicCode || liveOrder._id.slice(-6).toUpperCase()}</span><strong>{navigation?.phase === "customer" ? liveOrder.customerName || "Cliente final" : liveOrder.restaurant?.name || "Establecimiento Partner"}</strong><p><MapPin size={17} aria-hidden="true"/>{navigation?.address || "Destino no disponible"}</p></div>}
        <div className="active-sheet-expanded-content" aria-hidden={Boolean(sheetCollapsed && liveOrder)}>
          {offersLoading && !liveOrder ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Conectando con pedidos…</h1><p>Sincronizando tus ofertas de reparto en {subtitle}.</p></> : offersError ? <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1>Sin conexión temporal</h1><p>{offersError}. Tu jornada sigue activa; vuelve a sincronizar para recibir las ofertas pendientes.</p><button type="button" className="active-retry-button" onClick={onRefreshOffers}><RefreshCw size={16}/> Reintentar</button></> : liveOrder ? <>
            <p className="active-eyebrow">PIKI · {liveOrders.length === 1 ? "1 PEDIDO ACTIVO" : `${liveOrders.length} PEDIDOS ACTIVOS`}</p>
            <section className={`active-order-stack-item ${navigation?.phase === "customer" ? "phase-customer" : "phase-partner"} ${liveOrder.assignmentState === "offered" ? "is-offered" : "is-assigned"}`} key={liveOrder._id} data-order-id={liveOrder.publicCode || liveOrder._id}>{liveOrder.assignmentState === "offered" ? <IncomingOrderCard order={liveOrder}/> : <ActiveOrderCard order={liveOrder}/>}
              {liveOrder.assignmentState === "offered" && <><p className="active-assignment-note">Este pedido debe aceptarse, recogerse en el Partner y entregarse al cliente final. PIKI verificará cada paso con GPS y QR/PIN.</p><button type="button" className="active-order-button exact-accept-button" disabled={actionBusy} onClick={() => onAcceptOffer(liveOrder._id)}>ACEPTAR PEDIDO</button></>}
              {liveOrder.assignmentState === "assigned" && !isCustomerDeliveryPhase(liveOrder.status) && liveOrder.status !== "ready_for_pickup" && <p className="active-arrival-wait">El Partner está preparando el pedido. Podrás confirmar la recogida al estar a una manzana o menos cuando marque «Listo».</p>}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "ready_for_pickup" && <button type="button" className="active-order-button exact-pickup-button" disabled={actionBusy} onClick={() => onConfirmPickup(liveOrder._id)}><CheckCircle2 size={18}/> CONFIRMAR RETIRO</button>}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <button type="button" className="active-order-button exact-pickup-button" disabled={actionBusy} onClick={() => onOfferAction(liveOrder._id, "on_the_way")}><Navigation size={18}/> INICIAR RUTA AL CLIENTE</button>}
              {liveOrder.assignmentState === "assigned" && liveOrder.status === "on_the_way" && <button type="button" className="active-order-button active-qr-button" disabled={actionBusy} aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); openScanner(liveOrder._id); }}><Camera size={17}/> Escanear QR o PIN del cliente</button>}
              <button type="button" className="active-order-button active-gps-button" aria-label={`Abrir GPS hacia ${navigation?.phase === "partner" ? "el Partner" : "el cliente"}`} onClick={() => window.open(buildDirectionsUrl(navigation?.address || ""), "_blank", "noopener,noreferrer")}><Navigation size={17}/> GPS · {navigation?.phase === "partner" ? "PARTNER" : "CLIENTE"}</button>
              {liveOrders.length > 1 && <p className="active-pickup-pending">Hay {liveOrders.length - 1} pedido{liveOrders.length - 1 === 1 ? "" : "s"} más en cola. Se mostrará automáticamente cuando completes este.</p>}</section>
          </> : <><p className="active-eyebrow">PIKI · JORNADA INICIADA</p><h1 className="searching-orders-title">Buscando pedidos…</h1><p>Estás visible en {subtitle}. PIKI te avisará cuando haya una asignación; no necesitas refrescar.</p></>}
        </div>
      </section>
      {scannerOpen && selectedOrder && <section className="delivery-qr-dialog" role="dialog" aria-modal="true" aria-label="Confirmar entrega"><button type="button" className="delivery-qr-close" onClick={closeScanner} aria-label="Cerrar"><X size={18}/></button><p className="active-eyebrow">ENTREGA SEGURA</p><h2>Escanea el QR o introduce el PIN del cliente</h2><p>Basta con validar uno de los dos: PIN o QR. No hace falta usar ambos.</p><video ref={videoRef} muted playsInline className={scannerReady ? "delivery-qr-video" : "hidden"}/>{!scannerReady && <button type="button" className="active-order-button" onClick={startScanner}><Camera size={17}/> Abrir cámara para escanear QR</button>}<label>PIN o enlace QR del Customer<input value={qrValue} onChange={(event) => setQrValue(event.target.value)} placeholder="PIN o enlace QR del Customer" autoComplete="one-time-code" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label><button type="button" disabled={actionBusy || !qrValue.trim()} className="active-order-button" onClick={() => { onConfirmDelivery(selectedOrder._id, qrValue.trim()); closeScanner(); }}><ShieldCheck size={17}/> Confirmar entrega con QR/PIN</button></section>}
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
