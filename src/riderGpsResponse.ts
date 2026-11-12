import type { GpsPoint } from "./riderGpsPolicy";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Both fetch and Capacitor must validate the same nested legacy location ACK. */
export function isRiderGpsLocationAck(body: unknown, riderId: string, point: GpsPoint): boolean {
  const rider = record(record(body)?.rider);
  const location = record(rider?.location);
  const coordinates = location?.coordinates;
  return rider?.id === riderId
    && location?.type === "Point"
    && Array.isArray(coordinates) && coordinates.length === 2
    && coordinates[0] === point.longitude && coordinates[1] === point.latitude
    && typeof rider?.lastLocationAt === "string" && rider.lastLocationAt.trim() !== ""
    && Number.isFinite(Date.parse(rider.lastLocationAt));
}

const operationalMessages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "La API solicita revisar el acceso.",
  INVALID_TOKEN: "La API no acepta la credencial de esta sesión.",
  TOKEN_EXPIRED: "La API indica que la credencial ha caducado.",
  SESSION_EXPIRED: "La API indica que la sesión ha caducado.",
  UNAUTHORIZED: "La API solicita revisar el acceso.",
  PASSWORD_CHANGE_REQUIRED: "La API exige revisar la contraseña antes de continuar.",
  RIDER_ACCESS_DENIED: "La API no autoriza el acceso de esta sesión al rider.",
  RIDER_GPS_ACCESS_DENIED: "La API no autoriza a esta sesión a enviar GPS para este rider.",
  RIDER_SESSION_NOT_ACTIVE: "La API no ha validado una sesión operativa activa para enviar GPS. Revisa tu acceso; este aviso no finaliza tu turno.",
  TRACKING_SESSION_NOT_ACTIVE: "La API no ha validado una sesión de seguimiento activa.",
  INVALID_RIDER_ID: "La API no acepta el identificador de rider enviado.",
  INVALID_LOCATION: "La API no acepta el formato o los valores de la ubicación enviada.",
  CLIENT_UPDATE_REQUIRED: "La API solicita una versión admitida de la aplicación.",
};

/** Never display arbitrary error/code/message strings: they can contain private data. */
export function riderGpsResponseCode(body: unknown): string | undefined {
  const data = record(body);
  for (const value of [data?.error, data?.code]) {
    if (typeof value === "string" && Object.hasOwn(operationalMessages, value)) return value;
  }
  return undefined;
}

export function riderGpsHttpFailureDetail(status: number, body: unknown): string {
  const code = riderGpsResponseCode(body);
  const evidence = `HTTP ${status}${code ? ` · ${code}` : " · sin código reconocido"}`;
  return `La API no confirmó la ubicación (${evidence}). ${code ? operationalMessages[code] : "No se conoce la causa de esta respuesta."}`;
}

/** A transport exception is not an HTTP response or evidence that a token expired. */
export function riderGpsTransportFailureDetail(error: unknown): string {
  const name = record(error)?.name ?? (error instanceof Error ? error.name : undefined);
  return name === "TimeoutError" || name === "AbortError"
    ? "El envío GPS agotó el tiempo de espera. No se recibió una confirmación verificable ni se conoce el resultado HTTP."
    : "No se recibió una respuesta verificable al envío GPS. Revisa la conexión; la causa HTTP no está disponible.";
}
