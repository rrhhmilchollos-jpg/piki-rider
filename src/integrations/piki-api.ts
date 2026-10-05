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

export type TrackingSession = { _id: string; riderId: string; status: "active" | "stopped" | "degraded"; platform: "ios" | "android" | "web"; startedAt: string; lastSampleAt?: string | null };
export type TrackingSample = GeoCoordinate & { sampleId: string; recordedAt: string };
const trackingQueueKey = (riderId: string) => `piki-${location.hostname}-tracking-queue-${riderId}`;

function readTrackingQueue(riderId: string): TrackingSample[] {
  try { return JSON.parse(localStorage.getItem(trackingQueueKey(riderId)) || "[]") as TrackingSample[]; } catch { return []; }
}
function writeTrackingQueue(riderId: string, samples: TrackingSample[]) {
  localStorage.setItem(trackingQueueKey(riderId), JSON.stringify(samples.slice(-100)));
}
export async function startTrackingSession(token: string, riderId: string, platform: "ios" | "android" | "web", appVersion: string, consentVersion = "location-v1"): Promise<TrackingSession> {
  const result = await apiJson<{ session: TrackingSession }>(`/api/v1/riders/${encodeURIComponent(riderId)}/tracking/sessions`, token, { method: "POST", body: JSON.stringify({ platform, appVersion, consentVersion }) });
  return result.session;
}
export async function stopTrackingSession(token: string, riderId: string, sessionId: string) {
  return apiJson(`/api/v1/riders/${encodeURIComponent(riderId)}/tracking/sessions/${encodeURIComponent(sessionId)}/stop`, token, { method: "PATCH" });
}
export async function flushTrackingBatch(token: string, riderId: string, sessionId: string): Promise<void> {
  const queued = readTrackingQueue(riderId);
  if (!queued.length) return;
  const result = await apiJson<{ accepted: string[] }>(`/api/v1/riders/${encodeURIComponent(riderId)}/location/batch`, token, { method: "POST", body: JSON.stringify({ sessionId, samples: queued }) });
  const accepted = new Set(result.accepted || []);
  writeTrackingQueue(riderId, queued.filter((sample) => !accepted.has(sample.sampleId)));
}
export async function queueTrackingSample(token: string, riderId: string, sessionId: string, point: GeoCoordinate): Promise<void> {
  const sample: TrackingSample = { sampleId: `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy, recordedAt: new Date().toISOString() };
  const queued = readTrackingQueue(riderId);
  writeTrackingQueue(riderId, [...queued, sample]);
  await flushTrackingBatch(token, riderId, sessionId);
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
