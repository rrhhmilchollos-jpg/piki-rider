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

export type RiderPwaOperationState = {
  activeOrder?: unknown;
  shiftActive?: boolean;
  orderActionBusy?: boolean;
  shiftBusy?: boolean;
  supportFormBusy?: boolean;
  supportChatBusy?: boolean;
  applicationStatus?: string;
  startConsentOpen?: boolean;
  formEditing?: boolean;
};

export function isRiderPwaOperationActive(state: RiderPwaOperationState): boolean {
  return Boolean(
    state.activeOrder
    || state.shiftActive
    || state.orderActionBusy
    || state.shiftBusy
    || state.supportFormBusy
    || state.supportChatBusy
    || state.applicationStatus === "sending"
    || state.startConsentOpen
    || state.formEditing,
  );
}

export function subscribePwaOperationSafety(listener: (safety: PwaOperationSafety) => void): () => void {
  const receive = (event: Event) => listener((event as CustomEvent<PwaOperationSafety>).detail);
  window.addEventListener(eventName, receive);
  return () => window.removeEventListener(eventName, receive);
}
