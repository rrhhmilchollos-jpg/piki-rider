export type Shift = {
  day: string;
  date: string;
  start: string;
  end: string;
  zone: string;
  status: "assigned" | "pending" | "planned" | "active" | "completed" | "cancelled";
};

export type CurrentShift = {
  eligible: boolean;
  selfStartAllowed?: boolean;
  now?: { date: string; time: string };
  shift?: Shift | null;
};

export type RiderOffer = {
  _id: string;
  publicCode?: string;
  displayCode?: string | null;
  assignmentState: "offered" | "assigned";
  assignmentExpiresAt?: string | null;
  status: "ready_for_pickup" | "picked_up" | "on_the_way" | "accepted" | "preparing";
  phase?: string;
  etaMinutes?: number | null;
  vehicle?: string;
  restaurant?: { name?: string; address?: string; phone?: string; cuisine?: string; etaMinutes?: number[] };
  customerName?: string | null;
  deliveryAddress?: string | null;
  paymentMethod?: "stripe" | "bizum" | "cash";
  totalCents?: number;
	items?: Array<{
		name?: string;
		quantity?: number;
		priceCents?: number | null;
		totalCents?: number | null;
		unitPriceCents?: number | null;
		modifiers?: Array<{ name: string; quantity?: number; priceCents?: number | null }>;
	}>;
};
