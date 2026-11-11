import { withRequestDeadline } from "./requestDeadline";

export type PikiRealtimeEvent = { id?: string; type: string; payload: Record<string, unknown>; occurredAt?: string };

type RealtimeInput = {
  apiOrigin: string;
  token: string;
  surface: "partner" | "fleet" | "admin" | "rider";
  onEvent: (event: PikiRealtimeEvent) => void;
  onState?: (connected: boolean) => void;
  /** Called once; the stream is intentionally stopped so an expired token never floods 401s. */
  onAuthExpired?: (status: 401 | 428) => void;
  /** A role/surface mismatch is permanent until an administrator changes permissions. */
  onAuthorizationError?: (status: 403) => void;
};

export const realtimeConnectTimeoutMs = 15_000;
// The API sends a comment heartbeat every 20 s. Every received chunk counts,
// including comments, so quiet order traffic does not force reconnection.
export const realtimeSilenceTimeoutMs = 60_000;

function retryDelayMs(attempt: number, retryAfterMs = 0): number {
  if (retryAfterMs > 0) return Math.min(60_000, retryAfterMs);
  const exponential = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
  return exponential + Math.floor(Math.random() * 400);
}

function retryAfterMs(response: Response): number {
  const retryAfter = Number.parseInt(response.headers.get("Retry-After") || "", 10);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 0;
}

/** Authenticated SSE: bounded silence, resumable IDs and terminal auth failures. */
export function connectPikiRealtime(input: RealtimeInput) {
  const controller = new AbortController();
  const storageKey = `piki-realtime-last-event:${input.surface}`;
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    controller.signal.addEventListener("abort", finish, { once: true });
    if (controller.signal.aborted) finish();
  });

  const run = async () => {
    let failedAttempts = 0;
    while (!controller.signal.aborted) {
      let nextDelay = 0;
      const connection = new AbortController();
      const abortConnection = () => connection.abort();
      controller.signal.addEventListener("abort", abortConnection, { once: true });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const lastId = sessionStorage.getItem(storageKey) || "";
        const response = await withRequestDeadline((signal) => fetch(`${input.apiOrigin}/api/v1/realtime/events`, {
          signal,
          headers: {
            Authorization: `Bearer ${input.token}`,
            "X-PIKI-Surface": input.surface,
            ...(lastId ? { "Last-Event-ID": lastId } : {}),
          },
          credentials: "include",
        }), connection, realtimeConnectTimeoutMs);
        if (controller.signal.aborted) return;

        if (response.status === 401 || response.status === 428) {
          input.onState?.(false);
          input.onAuthExpired?.(response.status);
          return;
        }
        if (response.status === 403) {
          input.onState?.(false);
          input.onAuthorizationError?.(response.status);
          return;
        }
        if (response.status === 429) {
          nextDelay = retryAfterMs(response);
          throw new Error("SSE_RATE_LIMITED");
        }
        if (!response.ok || !response.body) throw new Error(`SSE_HTTP_${response.status}`);

        input.onState?.(true);
        reader = response.body.getReader();
        const activeReader = reader;
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await withRequestDeadline(() => activeReader.read(), connection, realtimeSilenceTimeoutMs);
          if (controller.signal.aborted || done) break;
          failedAttempts = 0;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            const eventId = lines.find((line) => line.startsWith("id: "))?.slice(4);
            const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
            if (!data) continue;
            try {
              const parsed = JSON.parse(data) as PikiRealtimeEvent;
              if (eventId) sessionStorage.setItem(storageKey, eventId);
              if (parsed.type) {
                window.dispatchEvent(new CustomEvent("piki:realtime", { detail: parsed }));
                input.onEvent(parsed);
              }
            } catch {
              // Ignore malformed events while preserving the established stream.
            }
          }
        }
        if (!controller.signal.aborted) input.onState?.(false);
      } catch {
        if (controller.signal.aborted) return;
        input.onState?.(false);
      } finally {
        controller.signal.removeEventListener("abort", abortConnection);
        connection.abort();
        if (reader) {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }

      if (!controller.signal.aborted) {
        failedAttempts += 1;
        await sleep(retryDelayMs(failedAttempts, nextDelay));
      }
    }
  };

  void run();
  return () => controller.abort();
}
