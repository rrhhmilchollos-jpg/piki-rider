import type { PwaOperationSafety } from "./pwaUpdateRecovery";

const eventName = "piki-pwa-operation-safety";

type PwaSafetyWindow = Window & {
  __pikiPwaOperationSafety?: PwaOperationSafety;
};

export function getPwaOperationSafety(): PwaOperationSafety {
  return (window as PwaSafetyWindow).__pikiPwaOperationSafety ?? { known: false, active: true };
}

export function publishPwaOperationSafety(safety: PwaOperationSafety): void {
  const target = window as PwaSafetyWindow;
  target.__pikiPwaOperationSafety = safety;
  window.dispatchEvent(new CustomEvent<PwaOperationSafety>(eventName, { detail: safety }));
}

export function subscribePwaOperationSafety(listener: (safety: PwaOperationSafety) => void): () => void {
  const receive = (event: Event) => listener((event as CustomEvent<PwaOperationSafety>).detail);
  window.addEventListener(eventName, receive);
  return () => window.removeEventListener(eventName, receive);
}
