import { ShieldCheck } from "lucide-react";
import type { RiderOffer } from "../types/rider";
import { PendingOfferCard } from "./ActiveShiftScreen";

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

/** Safe training preview using the exact offer card rendered for dispatch assignments. */
export default function RiderOfferDemoPreview() {
  return <section className="rider-offer-demo" aria-label="Vista previa de oferta y navegación de demostración">
    <div className="rider-demo-banner"><ShieldCheck size={16} /><span>VISTA PREVIA · DATOS DE DEMOSTRACIÓN</span></div>
    <p>Esta muestra no consulta la API, no contiene un pedido real y no abre navegación externa. Es la misma tarjeta que aparece cuando el dispatch asigna una oferta al rider.</p>
    <div className="active-shift-shell rider-demo-assignment-shell">
      <PendingOfferCard order={demoOffer} disabled onAccept={() => undefined} />
    </div>
    <div className="rider-demo-dispatch-note"><strong>Flujo real de dispatch</strong><span>Cuando llega <code>order.rider_offer</code>, PIKI actualiza las ofertas del rider y muestra esta misma tarjeta. El botón de esta preview está desactivado porque usa datos de demostración.</span></div>
  </section>;
}
