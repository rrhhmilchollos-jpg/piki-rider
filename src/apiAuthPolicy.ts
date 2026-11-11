const explicitAuthenticationErrors = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "SESSION_EXPIRED",
  "UNAUTHORIZED",
  "PASSWORD_CHANGE_REQUIRED",
]);

type AuthenticationErrorBody = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
};

function isExplicitAuthenticationSignal(value: unknown): boolean {
  const signal = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return [...explicitAuthenticationErrors].some((error) =>
    signal === error || signal.startsWith(`${error}:`) || signal.startsWith(`${error}_`),
  );
}

function bodyRequiresAuthentication(body: AuthenticationErrorBody): boolean {
  return [body.error, body.code, body.message].some(isExplicitAuthenticationSignal);
}

/**
 * API client errors contain the response body after `API <status>:`. Only
 * structured, explicit auth codes may clear a saved Rider session; a proxy or
 * CDN's generic 401 page is not sufficient evidence that the token expired.
 */
export function isRiderAuthenticationErrorMessage(message: string): boolean {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return false;
  try {
    const body = JSON.parse(message.slice(jsonStart)) as AuthenticationErrorBody;
    return Boolean(body && typeof body === "object" && bodyRequiresAuthentication(body));
  } catch {
    return false;
  }
}

/** Only discard a saved rider token when the API identifies an authentication failure. */
export async function requiresRiderAuthentication(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403 && response.status !== 428) return false;

  const body = await response.clone().json().catch(() => ({})) as AuthenticationErrorBody;
  return bodyRequiresAuthentication(body);
}
