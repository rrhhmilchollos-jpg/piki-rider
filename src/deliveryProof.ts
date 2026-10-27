export function normalizeDeliveryProof(value: string): string {
  const trimmed = value.trim();
  // The Customer PIN is a six-character hexadecimal code. QR URLs/tokens are
  // case-sensitive and must never be uppercased together with a typed PIN.
  return /^[a-f0-9]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function deliveryProofPayload(value: string): { deliveryQr: string } {
  // The canonical API's legacy field accepts either the PIN or the QR URL.
  // Sending the same value in a second field incorrectly implies two proofs.
  return { deliveryQr: normalizeDeliveryProof(value) };
}
