import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { resolvePikiApiOrigin } from "../apiOrigin";
import { withRequestDeadline } from "../requestDeadline";

export type GeoCoordinate = { latitude: number; longitude: number; accuracy?: number; heading?: number; speedMps?: number };
export type OperationalZone = {
  _id?: string;
  slug: string;
  name: string;
  isActive?: boolean;
  polygon?:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};
export type MobilityAdvice = {
  algorithmVersion: string;
  shouldMove: boolean;
  currentZone: { slug: string; name: string } | null;
  currentDemand: number;
  targetZone: { slug: string; name: string; distanceKm: number; demand: number } | null;
  reason: "balanced" | "low_activity" | "higher_demand_nearby";
  cooldownMinutes: number;
};

const apiOrigin = resolvePikiApiOrigin(import.meta.env.VITE_API_URL);

export function apiUrl(path: string) {
  return `${apiOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function bearerHeaders(token: string): Record<string, string> {
  return token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
}

async function apiJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { ...bearerHeaders(token), ...(init?.headers || {}), "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function loadOperationalZones(token: string): Promise<OperationalZone[]> {
  const result = await apiJson<{ zones: OperationalZone[] }>("/api/v1/riders/operational-map", token);
  return result.zones || [];
}

export async function publishRiderLocation(token: string, riderId: string, point: GeoCoordinate) {
  const path = `/api/v1/riders/${encodeURIComponent(riderId)}/location`;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: apiUrl(path),
      headers: { ...bearerHeaders(token), "Content-Type": "application/json" },
      data: point,
      connectTimeout: 15_000,
      readTimeout: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      const details = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      throw new Error(`API ${response.status}: ${details}`);
    }
    return response.data;
  }
  return apiJson(path, token, { method: "POST", body: JSON.stringify(point) });
}

export async function loadMobilityAdvice(token: string, riderId: string, lowActivityMinutes: number): Promise<MobilityAdvice> {
  const result = await apiJson<{ advice: MobilityAdvice }>(`/api/v1/riders/${encodeURIComponent(riderId)}/mobility-advice?lowActivityMinutes=${Math.round(lowActivityMinutes)}`, token);
  return result.advice;
}

export type RiderOrderMessage = { _id: string; body: string; senderRole: "rider" | "customer" | "admin"; createdAt: string };
export async function loadRiderOrderMessages(token: string, riderId: string, orderId: string): Promise<RiderOrderMessage[]> {
  const result = await apiJson<{ messages: RiderOrderMessage[] }>(`/api/v1/riders/${encodeURIComponent(riderId)}/orders/${encodeURIComponent(orderId)}/messages`, token);
  return result.messages || [];
}
export async function sendRiderOrderMessage(token: string, riderId: string, orderId: string, body: string): Promise<RiderOrderMessage> {
  const result = await apiJson<{ message: RiderOrderMessage }>(`/api/v1/riders/${encodeURIComponent(riderId)}/orders/${encodeURIComponent(orderId)}/messages`, token, { method: "POST", body: JSON.stringify({ body }) });
  return result.message;
}

export type RiderOfferAcceptance = { message: string; pickupDeadlineAt: string | null };
export const riderOfferAcceptanceTimeoutMs = 15_000;

export class RiderOfferAcceptanceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "RiderOfferAcceptanceError";
    this.status = status;
    this.code = code;
  }
}

const riderOfferAcceptanceErrors: Record<string, string> = {
  RIDER_OFFER_EXPIRED: "La oferta ha caducado. Se actualizarán tus pedidos; esto no confirma el cierre de tu jornada.",
  RIDER_OFFER_NOT_FOUND: "La oferta ya no está disponible. Se actualizarán tus pedidos.",
  RIDER_OFFER_NOT_ELIGIBLE: "La API no confirma que esta oferta siga siendo elegible. Se actualizarán tus pedidos; revisa tu turno, GPS y zona sin forzar disponibilidad.",
  ORDER_CHANGED_RETRY: "La asignación ha cambiado. Se actualizarán tus pedidos.",
  RIDER_ACCESS_DENIED: "Esta oferta no corresponde a tu cuenta de Rider.",
  AUTHENTICATION_REQUIRED: "Tu sesión no permite confirmar este reparto. Inicia sesión de nuevo si la API lo requiere.",
  PASSWORD_CHANGE_REQUIRED: "Debes revisar tu acceso antes de confirmar este reparto.",
  CLIENT_UPDATE_REQUIRED: "La API requiere una actualización de la aplicación antes de confirmar este reparto.",
  RIDER_OFFER_ACK_INVALID: "No se ha recibido un acuse válido de este reparto. Se consultarán tus pedidos antes de volver a intentarlo.",
  RIDER_OFFER_ACCEPT_FAILED: "No se pudo confirmar el reparto. Se consultarán tus pedidos antes de volver a intentarlo.",
};

export async function acceptRiderOffer(token: string, riderId: string, orderId: string): Promise<RiderOfferAcceptance> {
  // One POST only. Timeout/invalid ACK is an unknown outcome, not a rejection:
  // the caller must read persisted offers, never automatically replay the POST.
  return withRequestDeadline(async (signal) => {
    const response = await fetch(apiUrl(`/api/v1/riders/${encodeURIComponent(riderId)}/orders/${encodeURIComponent(orderId)}/accept-offer`), {
      method: "POST",
      headers: { ...bearerHeaders(token), "Content-Type": "application/json" },
      signal,
    });
    signal.throwIfAborted();
    const data: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    const body = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (!response.ok) {
      const rawCode = typeof body?.error === "string" ? body.error : "";
      const code = Object.hasOwn(riderOfferAcceptanceErrors, rawCode) ? rawCode : "RIDER_OFFER_ACCEPT_FAILED";
      throw new RiderOfferAcceptanceError(riderOfferAcceptanceErrors[code], response.status, code);
    }
    const order = body?.order && typeof body.order === "object" && !Array.isArray(body.order)
      ? body.order as Record<string, unknown> : null;
    // This route's published ACK is { order: updated, pickupDeadlineAt: null }.
    // HTML, empty bodies, an unrelated order/rider and an offered/terminal order
    // cannot confirm acceptance merely because the transport returned 2xx.
    if (!order || order._id !== orderId || order.riderId !== riderId || order.assignmentState !== "assigned"
      || order.assignmentExpiresAt !== null || order.pickupDeadlineAt !== null
      || !["pending", "accepted", "preparing", "ready_for_pickup", "picked_up", "on_the_way"].includes(String(order.status))) {
      throw new RiderOfferAcceptanceError(riderOfferAcceptanceErrors.RIDER_OFFER_ACK_INVALID, response.status, "RIDER_OFFER_ACK_INVALID");
    }
    return { message: "Pedido aceptado. El Partner avisará cuando esté listo para retirar.", pickupDeadlineAt: null };
  }, new AbortController(), riderOfferAcceptanceTimeoutMs);
}

export type RiderSupportTicket = { id: string; ticketNumber: string; status: string };
export async function createRiderSupportTicket(input: { token: string; riderId: string; subject: string; description: string; priority?: "low" | "normal" | "high" | "urgent"; orderId?: string }): Promise<RiderSupportTicket> {
  const result = await apiJson<{ ticket: RiderSupportTicket }>(`/api/v1/riders/${encodeURIComponent(input.riderId)}/support/tickets`, input.token, {
    method: "POST",
    body: JSON.stringify({ subject: input.subject, description: input.description, priority: input.priority || "normal", ...(input.orderId ? { orderId: input.orderId } : {}) }),
  });
  return result.ticket;
}


export type RiderIncentiveEntry = { _id: string; entryType: string; amountCents: number; status: "earned" | "paid" | "reversed"; createdAt: string };
export type RiderIncentiveSnapshot = {
  program: {
    referralsEnabled: boolean;
    hourlyGuaranteeEnabled: boolean;
    monthlyCapCents: number;
    budgetCommittedCents?: number;
    budgetRemainingCents?: number;
    policy: { hourlyRateCents: number; requiredShiftHours: number; minimumAcceptanceRate: number; centralZoneSlug: string; acquisitionDeliveries: number; acquisitionBonusCents: number; referralDeliveries: number; referralBonusCents: number; campaignStartAt?: string | null };
  };
  referral: null | { code: string | null; referredBy: string | null; completedDeliveries: number; eligibleToClaim?: boolean; acquisitionProgress: number; acquisitionTarget: number; referralProgress: number | null; referralTarget: number | null; successfulInvitations: number };
  wallet: { earnedCents: number; paidCents: number; entries: RiderIncentiveEntry[] };
  guarantee: { active: boolean; currentShift: null | { date: string; startTime: string; endTime: string; zoneSlug?: string; sampleCount: number; trackedSeconds: number; centralZoneOk: boolean | null } };
};
export async function loadRiderIncentives(token: string, riderId: string): Promise<RiderIncentiveSnapshot> {
  return apiJson<RiderIncentiveSnapshot>(`/api/v1/riders/${encodeURIComponent(riderId)}/incentives`, token);
}
export async function claimRiderReferralCode(token: string, riderId: string, code: string): Promise<{ claimed: boolean }> {
  return apiJson<{ claimed: boolean }>(`/api/v1/riders/${encodeURIComponent(riderId)}/referrals/claim`, token, { method: "POST", body: JSON.stringify({ code }) });
}
