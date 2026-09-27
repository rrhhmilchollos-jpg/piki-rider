export type PickupProofKind = "qr" | "pin";

export type PickupProof = {
  kind: PickupProofKind;
  value: string;
};

/**
 * QR/PIN is an optional operational aid. An empty proof is intentionally valid
 * so automated and assisted flows can confirm pickup without a customer code.
 */
export function normalizePickupProof(kind: PickupProofKind, value: string): PickupProof | null {
  const normalized = value.trim();
  return normalized ? { kind, value: normalized } : null;
}
