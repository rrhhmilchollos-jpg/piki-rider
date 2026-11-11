/** Abort and settle even if an underlying transport does not reject on abort. */
export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) { abort(); return; }
      timer = setTimeout(() => {
        controller.abort(new DOMException("La sincronización ha superado el tiempo de espera", "TimeoutError"));
      }, timeoutMs);
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return request(controller.signal);
      }).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    if (abort) controller.signal.removeEventListener("abort", abort);
  }
}
