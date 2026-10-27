export type GeoCoordinate = { latitude: number; longitude: number; accuracy?: number };
export type OperationalZone = {
  _id?: string;
  slug: string;
  name: string;
  isActive?: boolean;
  polygon?: { type: "Polygon"; coordinates: number[][][] };
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

const apiOrigin = (import.meta.env.VITE_API_URL ?? "https://api.pikidelivery.com").replace(/\/$/, "");

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
  return apiJson(`/api/v1/riders/${encodeURIComponent(riderId)}/location`, token, {
    method: "POST",
    body: JSON.stringify(point),
  });
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

export type RiderOfferAcceptance = { message?: string; pickupDeadlineAt?: string };

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
  RIDER_OFFER_EXPIRED: "Este pedido se está reasignando. Se ha liberado tu jornada y se actualizarán tus ofertas.",
  RIDER_OFFER_NOT_FOUND: "La oferta ya no está disponible. Se actualizarán tus pedidos.",
  ORDER_CHANGED_RETRY: "La asignación ha cambiado. Se actualizarán tus pedidos.",
  RIDER_ACCESS_DENIED: "Esta oferta no corresponde a tu cuenta de Rider.",
};

export async function acceptRiderOffer(token: string, riderId: string, orderId: string): Promise<RiderOfferAcceptance> {
  const response = await fetch(apiUrl(`/api/v1/riders/${encodeURIComponent(riderId)}/orders/${encodeURIComponent(orderId)}/accept-offer`), {
    method: "POST",
    headers: { ...bearerHeaders(token), "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => ({})) as { message?: string; error?: string; pickupDeadlineAt?: string };
  if (!response.ok) {
    const code = body.error || "RIDER_OFFER_ACCEPT_FAILED";
    const userMessage = code === "RIDER_OFFER_EXPIRED"
      ? riderOfferAcceptanceErrors.RIDER_OFFER_EXPIRED
      : body.message || riderOfferAcceptanceErrors[code] || "No se pudo aceptar el reparto. Se actualizarán tus pedidos.";
    throw new RiderOfferAcceptanceError(userMessage, response.status, code);
  }
  return body;
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
