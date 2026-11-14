const CANONICAL_PIKI_API_ORIGIN = "https://api.pikidelivery.com";

/** Usa el dominio canónico del API de PIKI salvo que el entorno indique otro origen. */
export function resolvePikiApiOrigin(configuredOrigin?: string): string {
  const origin = configuredOrigin?.trim() || CANONICAL_PIKI_API_ORIGIN;
  return origin.replace(/\/$/, "");
}
