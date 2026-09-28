const explicitAuthenticationErrors = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "SESSION_EXPIRED",
  "UNAUTHORIZED",
]);

/** Only discard a saved rider token when the API identifies an authentication failure. */
export async function requiresRiderAuthentication(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  if (response.status !== 403 && response.status !== 428) return false;

  const body = await response.clone().json().catch(() => ({})) as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
  };
  const signal = String(body.error || body.code || body.message || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return [...explicitAuthenticationErrors].some((error) =>
    signal === error || signal.startsWith(`${error}:`) || signal.startsWith(`${error}_`),
  );
}
