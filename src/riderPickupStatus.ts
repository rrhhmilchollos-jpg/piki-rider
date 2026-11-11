export type RiderPickupRequest = { orderId: string; status: "sending" | "verifying" };

/** Request state is not an order transition or proof of pickup. */
export function riderPickupStatusMessage(request: RiderPickupRequest | null | undefined, orderId: string, orderStatus: string): string {
  if (!request || request.orderId !== orderId || ["picked_up", "on_the_way"].includes(orderStatus)) return "";
  return request.status === "sending"
    ? "Enviando recogida… Aún no está confirmada; mantén la ruta al Partner."
    : "Recogida pendiente de verificar. Sincroniza el pedido antes de reintentar; no se ha confirmado la ruta al cliente.";
}
