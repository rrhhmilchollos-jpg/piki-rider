export function assignmentCountdownSeconds(
  deadline: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!deadline) return null;
  const expiresAt = Date.parse(deadline);
  if (!Number.isFinite(expiresAt)) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}
