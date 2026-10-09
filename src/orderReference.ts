export function visibleOrderReference(value?: string, fallback?: string): string {
  const source = String(value || fallback || "").replace(/\D/g, "");
  return source.length >= 3 ? `#${source.slice(-3)}#` : `#${String(value || fallback || "—")}#`;
}
