import type { RiderOffer } from "./types/rider";
import { withRequestDeadline } from "./requestDeadline";

export const riderOffersTimeoutMs = 15_000;

export function parseRiderOffersSnapshot(data: unknown): RiderOffer[] {
  const offers = (data as { offers?: unknown } | null)?.offers;
  if (!Array.isArray(offers) || offers.some((offer) => !offer || typeof offer._id !== "string" || !offer._id.trim()
    || !["offered", "assigned"].includes(offer.assignmentState)
    || !["pending", "accepted", "preparing", "ready_for_pickup", "picked_up", "on_the_way"].includes(offer.status))) {
    throw new Error("La API no devolvió un snapshot de ofertas válido");
  }
  return offers;
}

export function isLivePendingOffer(offer: RiderOffer, now = Date.now()) {
  if (offer.assignmentState !== "offered" || !offer._id.trim()) return false;
  if (["picked_up", "on_the_way"].includes(offer.status)) return false;
  if (!offer.assignmentExpiresAt) return true;
  const expiry = Date.parse(offer.assignmentExpiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

export function newPendingOfferIds(offers: RiderOffer[], known: Set<string> | null, now = Date.now()) {
  return offers.filter((offer) => isLivePendingOffer(offer, now) && !known?.has(offer._id)).map((offer) => offer._id);
}

type Input = {
  request: (signal: AbortSignal) => Promise<RiderOffer[]>;
  onSnapshot: (offers: RiderOffer[]) => void;
  onError: (error: unknown) => void;
  onLoading: (loading: boolean) => void;
  timeoutMs?: number;
};

/** Polling, SSE and manual retry share one request; event bursts queue one resync. */
export function createRiderOffersSync(input: Input) {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let queued = false;
  const refresh = (queueIfBusy = true): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (inFlight) {
      if (queueIfBusy) queued = true;
      return inFlight;
    }
    input.onLoading(true);
    inFlight = (async () => {
      do {
        queued = false;
        controller = new AbortController();
        try {
          const offers = await withRequestDeadline(input.request, controller, input.timeoutMs ?? riderOffersTimeoutMs);
          if (!disposed) input.onSnapshot(offers);
        } catch (error) {
          if (!disposed) input.onError(error);
        }
      } while (queued && !disposed);
    })().finally(() => {
      inFlight = null;
      controller = null;
      if (!disposed) input.onLoading(false);
    });
    return inFlight;
  };
  return {
    refresh,
    dispose() {
      disposed = true;
      queued = false;
      controller?.abort();
    },
  };
}
