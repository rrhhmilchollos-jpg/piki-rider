export function offerSecondsRemaining(expiresAt?: string | null, now = Date.now()): number {
  if (!expiresAt) return 60;
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return 60;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}
