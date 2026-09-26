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
