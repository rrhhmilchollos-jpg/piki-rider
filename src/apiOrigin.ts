const CANONICAL_PIKI_API_ORIGIN = "https://api.pikidelivery.com";
const RENDER_MIGRATION_API_ORIGIN = "https://piki-api-37nr.onrender.com";

/**
 * Mantiene Rider operativo mientras Render libera el dominio retenido en la cuenta
 * anterior. Retirar este fallback al transferir api.pikidelivery.com al servicio
 * piki-api de la cuenta actual.
 */
export function resolvePikiApiOrigin(configuredOrigin?: string): string {
  const origin = (configuredOrigin || CANONICAL_PIKI_API_ORIGIN).replace(/\/$/, "");
  return origin === CANONICAL_PIKI_API_ORIGIN ? RENDER_MIGRATION_API_ORIGIN : origin;
}
