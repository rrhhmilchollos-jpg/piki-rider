import { MapPin, Navigation, ShieldCheck, ShoppingBag } from "lucide-react";
import { getRiderNavigationTarget } from "../orderNavigation";
import type { RiderOffer } from "../types/rider";

const demoOffer: RiderOffer = {
  _id: "demo-offer-only",
  assignmentState: "offered",
  status: "ready_for_pickup",
  publicCode: "DEMO-001",
  restaurant: {
    name: "Comercio de demostración",
    address: "Dirección de ejemplo · no operativa",
    etaMinutes: [4],
  },
  deliveryAddress: "Destino de demostración · no navegable",
  customerName: "Cliente de demostración",
  etaMinutes: 14,
  deliveryFeeCents: 320,
  items: [{ name: "Producto de muestra", quantity: 1, totalCents: 850 }],
};

const demoCustomerRoute: RiderOffer = {
  ...demoOffer,
  assignmentState: "assigned",
  status: "picked_up",
};

function euro(cents: number | undefined) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

/** Static training preview. It never receives, displays or mutates production orders. */
export default function RiderOfferDemoPreview() {
  const customerTarget = getRiderNavigationTarget(demoCustomerRoute);

  return <section className="rider-offer-demo" aria-label="Vista previa de oferta y navegación de demostración">
    <div className="rider-demo-banner"><ShieldCheck size={16} /><span>VISTA PREVIA · DATOS DE DEMOSTRACIÓN</span></div>
    <p>Esta muestra no consulta la API, no contiene un pedido real y no abre navegación externa.</p>
    <div className="rider-demo-grid">
      <article className="rider-demo-card">
        <span className="rider-demo-kicker"><ShoppingBag size={15} /> OFERTA DE EJEMPLO</span>
        <h3>{demoOffer.restaurant?.name}</h3>
        <p>{demoOffer.restaurant?.address}</p>
        <dl>
          <div><dt>Recogida</dt><dd>{demoOffer.restaurant?.etaMinutes?.[0]} min</dd></div>
          <div><dt>Entrega</dt><dd>{demoOffer.etaMinutes} min</dd></div>
          <div><dt>Ganancia</dt><dd>{euro(demoOffer.deliveryFeeCents)}</dd></div>
        </dl>
        <button type="button" disabled>ACEPTAR PEDIDO · DEMO</button>
      </article>
      <article className="rider-demo-card rider-demo-navigation">
        <span className="rider-demo-kicker"><Navigation size={15} /> NAVEGACIÓN AL CLIENTE</span>
        <h3>{customerTarget.label}</h3>
        <p><MapPin size={16} /> {customerTarget.address}</p>
        <small>Destino de muestra. Ninguna coordenada ni dirección de cliente real se carga o comparte.</small>
        <button type="button" disabled>ABRIR NAVEGACIÓN · DEMO</button>
      </article>
    </div>
  </section>;
}
