export const RIDER_NETWORK_ERROR_MESSAGE = "No hay conexión con PIKI ahora mismo. Comprueba tus datos móviles o Wi‑Fi y vuelve a intentarlo.";

export class RiderNetworkError extends Error {
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super(RIDER_NETWORK_ERROR_MESSAGE);
    this.name = "RiderNetworkError";
    this.cause = cause;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RiderFetchOptions = { retries?: number; retryDelayMs?: number };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof RiderNetworkError) return true;
  if (isAbortError(error)) return false;
  if (!(error instanceof Error)) return true;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|offline/i.test(error.message);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/** Safe reads can retry; mutations never replay because their outcome may be unknown. */
export function createRiderFetch(nativeFetch: FetchLike, options: RiderFetchOptions = {}): FetchLike {
  const retryDelayMs = options.retryDelayMs ?? 500;
  const configuredRetries = options.retries ?? 2;

  return async (input, init) => {
    const retryable = ["GET", "HEAD", "OPTIONS"].includes(requestMethod(input, init));
    const retries = retryable ? configuredRetries : 0;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await nativeFetch(input, init);
      } catch (error) {
        lastError = error;
        if (isAbortError(error)) throw error;
        if (!isNetworkFailure(error) || attempt >= retries) throw new RiderNetworkError(error);
        await wait(retryDelayMs * (attempt + 1));
      }
    }

    throw new RiderNetworkError(lastError);
  };
}

export function riderErrorMessage(error: unknown, fallback = "No se pudo completar la operación."): string {
  if (error instanceof RiderNetworkError || isNetworkFailure(error)) return RIDER_NETWORK_ERROR_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
