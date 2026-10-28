export type QueueOrder = {
  _id: string;
  createdAt?: string | null;
  requestedAt?: string | null;
  assignedAt?: string | null;
  created_at?: string | null;
  requested_at?: string | null;
};

function orderTimestamp(order: QueueOrder): number | null {
  const raw = order.requestedAt || order.createdAt || order.assignedAt || order.requested_at || order.created_at;
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * The API normally returns offers in priority order. When timestamps are
 * available, oldest requested order wins; otherwise response order is kept.
 */
export function orderRiderQueue<T extends QueueOrder>(orders: T[]): T[] {
  const timestamped = orders.map((order, index) => ({ order, index, timestamp: orderTimestamp(order) }));
  // The API's order is authoritative if even one deadline is absent or invalid.
  // Mixing index and timestamp comparisons makes Array.sort's comparator non-transitive.
  if (timestamped.some(({ timestamp }) => timestamp == null)) return orders.slice();
  return timestamped
    .sort((left, right) => left.timestamp! - right.timestamp! || left.index - right.index)
    .map(({ order }) => order);
}
