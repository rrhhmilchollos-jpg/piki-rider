import type { RiderOffer } from "./types/rider";

export const riderOrderProgressSteps = [
  { key: "pickup", label: "Recoger" },
  { key: "route", label: "En camino" },
  { key: "delivery", label: "Entregado" },
] as const;

export type RiderOrderProgressStep = (typeof riderOrderProgressSteps)[number]["key"];
export type RiderOrderProgressState = "upcoming" | "current" | "done";
export type RiderOrderProgress = Record<RiderOrderProgressStep, RiderOrderProgressState>;

/**
 * The rider surface receives only active offers. Delivery confirmation removes
 * the offer, so the terminal delivery step remains upcoming while the rider is
 * still on route and is never inferred from pickup confirmation.
 */
export function getRiderOrderProgress(status: RiderOffer["status"]): RiderOrderProgress {
  const pickupConfirmed = status === "picked_up" || status === "on_the_way";

  return {
    pickup: pickupConfirmed ? "done" : "current",
    route: pickupConfirmed ? "current" : "upcoming",
    delivery: "upcoming",
  };
}
