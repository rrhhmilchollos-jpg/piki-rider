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
  return orders
    .map((order, index) => ({ order, index, timestamp: orderTimestamp(order) }))
    .sort((left, right) => {
      if (left.timestamp == null || right.timestamp == null) return left.index - right.index;
      return left.timestamp - right.timestamp || left.index - right.index;
    })
    .map(({ order }) => order);
}
