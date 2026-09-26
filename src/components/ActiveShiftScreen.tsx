import { CircleHelp, ClipboardList, Headphones, Menu, Navigation, Power, RefreshCw, ShieldCheck } from "lucide-react";
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
  toast: string;
  onStop: () => void;
  onOpenOperations: () => void;
  onSupport: () => void;
  onRefreshOffers: () => void;
  onOfferAction: (orderId: string, action: "accept" | "picked_up" | "on_the_way") => void;
  onError: (message: string) => void;
};

function routeLabel(order: RiderOffer) {
  if (order.assignmentState === "offered") return "Nueva oferta de reparto";
  if (order.status === "ready_for_pickup" || order.status === "preparing") return "Ve al establecimiento";
  if (order.status === "picked_up") return "Confirma el inicio de ruta";
  if (order.status === "on_the_way") return "Entrega en curso";
  return "Pedido asignado";
}

export default function ActiveShiftScreen({ token, riderId, currentShift, offers, offersLoading, offersError, shiftBusy, toast, onStop, onOpenOperations, onSupport, onRefreshOffers, onOfferAction, onError }: Props) {
  const offered = offers.find((order) => order.assignmentState === "offered");
  const assigned = offers.find((order) => order.assignmentState === "assigned");
  const liveOrder = offered || assigned;
  const subtitle = currentShift.shift?.zone ? `Zona ${currentShift.shift.zone}` : "Xàtiva";

  return <main className="active-shift-shell" aria-label="Jornada activa PIKI Rider">
    <section className="active-map real-google-map-section">
      <LiveGoogleMap token={token} riderId={riderId} active onError={onError}/>
      <button type="button" className="active-menu-button" onClick={onOpenOperations} aria-label="Abrir operaciones"><Menu size={24}/></button>
      <div className="online-pill" aria-live="polite"><span>Estado</span><strong>En línea</strong><i className="online-dot"/></div>
      <button type="button" className="active-help-button" onClick={onSupport} aria-label="Abrir soporte"><Headphones size={23}/></button>

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
          {liveOrder.assignmentState === "offered" && <button type="button" className="active-order-button" onClick={() => onOfferAction(liveOrder._id, "accept")}><ClipboardList size={17}/> Aceptar reparto</button>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "ready_for_pickup" && <button type="button" className="active-order-button" onClick={() => onOfferAction(liveOrder._id, "picked_up")}><Navigation size={17}/> Confirmar recogida</button>}
          {liveOrder.assignmentState === "assigned" && liveOrder.status === "picked_up" && <button type="button" className="active-order-button" onClick={() => onOfferAction(liveOrder._id, "on_the_way")}><Navigation size={17}/> Iniciar ruta</button>}
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
      {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
    </section>
  </main>;
}
