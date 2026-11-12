import { isRiderGpsStatusBlocked } from "./riderGpsPolicy";
import { normalizeRiderShift } from "./riderShiftSync";
import type { CurrentShift, Shift } from "./types/rider";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** HTTP success alone is not a start: require the existing API's active-slot acknowledgement. */
export function parseRiderStartAcknowledgement(body: unknown, riderId: string): Shift | null {
  const value = record(body);
  const rider = record(value?.rider);
  const rawShift = record(value?.shift);
  if (!value || value.error || value.success === false || value.locationRequired !== false || !rider || !rawShift
    || !riderId || rider.id !== riderId || rawShift.riderId !== riderId
    || !["available", "busy"].includes(String(rider.status)) || rawShift.status !== "active") return null;
  const date = typeof rawShift.date === "string" ? rawShift.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  const shift = normalizeRiderShift(rawShift);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!shift.date || !time.test(shift.start) || !time.test(shift.end)) return null;
  return shift;
}

export function riderStartFailureMessage(body: unknown, unconfirmed = false): string {
  const value = record(body);
  if ((!unconfirmed || value?.error || value?.locationRequired === true)
    && typeof value?.message === "string" && value.message.trim()) return value.message;
  switch (value?.error) {
    case "FRESH_LOCATION_REQUIRED": return "Jornada bloqueada: activa y comparte una posición GPS real antes de continuar.";
    case "SHIFT_OUTSIDE_SCHEDULE": return "No hay un turno asignado disponible en esta franja. Revisa Horarios o contacta con Fleet.";
    case "RIDER_ACCESS_DENIED": return "Esta sesión no tiene acceso a la cuenta Rider. Inicia sesión con la cuenta correspondiente.";
    case "AUTHENTICATION_REQUIRED":
    case "RIDER_EMPLOYEE_SESSION_REQUIRED": return "Tu sesión Rider no está validada. Inicia sesión de nuevo.";
    case "RIDER_ACCOUNT_NOT_LINKED": return "No hay una cuenta Rider vinculada a esta sesión. Contacta con Fleet.";
    default: return value?.locationRequired === true
      ? "La jornada sigue bloqueada: activa la ubicación y comparte una posición GPS real."
      : "La API no ha confirmado una jornada activa. Se comprobará el estado antes de mostrarte disponible.";
  }
}

/** Explain only known blockers; a reminder or local clock never grants a shift. */
export function riderStartBlock(input: { riderId: string; riderStatus: string; currentShift: CurrentShift }): { label: string; message: string } | null {
  if (!input.riderId) return { label: "SESIÓN NO VALIDADA", message: "No hay una cuenta Rider vinculada y validada en esta sesión." };
  if (isRiderGpsStatusBlocked(input.riderStatus)) return { label: "ALTA NO OPERATIVA", message: "Tu alta Rider sigue pendiente o no está operativa. Contacta con Fleet antes de iniciar jornada." };
  if (input.currentShift.eligible) return null;
  return { label: "SIN TURNO DISPONIBLE", message: "La API no confirma un turno disponible ahora. Revisa Horarios o contacta con Fleet. El sonido del recordatorio no inicia la jornada." };
}
