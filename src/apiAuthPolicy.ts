const explicitAuthenticationErrors = new Set([
  "AUTHENTICATION_REQUIRED",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "SESSION_EXPIRED",
  "PASSWORD_CHANGE_REQUIRED",
]);

type AuthenticationErrorBody = {
  code?: unknown;
  error?: unknown;
};

function isExplicitAuthenticationSignal(value: unknown): boolean {
  // Match exact machine codes only. Generic "Unauthorized" (even uppercase),
  // transformed free text and upstream-suffixed codes are ambiguous proxies.
  return typeof value === "string" && explicitAuthenticationErrors.has(value);
}

function bodyRequiresAuthentication(body: AuthenticationErrorBody): boolean {
  // Free-text messages such as a proxy's {"message":"Unauthorized"} are not
  // evidence that this bearer token was rejected by the authentication API.
  return [body.error, body.code].some(isExplicitAuthenticationSignal);
}

/** Native HTTP and fetch must use the same explicit authentication evidence. */
export function riderResponseRequiresAuthentication(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403 && status !== 428) return false;
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && bodyRequiresAuthentication(body as AuthenticationErrorBody));
}

/**
 * API client errors contain the response body after `API <status>:`. Only
 * structured, explicit auth codes may clear a saved Rider session; a proxy or
 * CDN's generic 401 page is not sufficient evidence that the token expired.
 */
export function isRiderAuthenticationErrorMessage(message: string): boolean {
  const prefix = /^API\s+(401|403|428):\s*/.exec(message);
  if (!prefix) return false;
  try {
    const body: unknown = JSON.parse(message.slice(prefix[0].length));
    return riderResponseRequiresAuthentication(Number(prefix[1]), body);
  } catch {
    return false;
  }
}

/** Only discard a saved rider token when the API identifies an authentication failure. */
export async function requiresRiderAuthentication(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403 && response.status !== 428) return false;

  const body = await response.clone().json().catch(() => ({})) as AuthenticationErrorBody;
  return riderResponseRequiresAuthentication(response.status, body);
}
