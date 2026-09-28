export type PikiRealtimeEvent = { id?: string; type: string; payload: Record<string, unknown>; occurredAt?: string };

export function connectPikiRealtime(input: { apiOrigin: string; token: string; surface: "partner" | "fleet" | "admin" | "rider"; onEvent: (event: PikiRealtimeEvent) => void; onState?: (connected: boolean) => void }) {
  const controller = new AbortController();
  const storageKey = `piki-realtime-last-event:${input.surface}`;
  const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const lastId = sessionStorage.getItem(storageKey) || "";
        const response = await fetch(`${input.apiOrigin}/api/v1/realtime/events`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${input.token}`, "X-PIKI-Surface": input.surface, ...(lastId ? { "Last-Event-ID": lastId } : {}) },
          credentials: "include",
        });
        if (!response.ok || !response.body) throw new Error(`SSE_HTTP_${response.status}`);
        input.onState?.(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
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
              if (parsed.type) { window.dispatchEvent(new CustomEvent("piki:realtime", { detail: parsed })); input.onEvent(parsed); }
            } catch { /* malformed frames are ignored and the stream continues */ }
          }
        }
      } catch { input.onState?.(false); }
      if (!controller.signal.aborted) await sleep(1_500);
    }
  };
  void run();
  return () => controller.abort();
}
