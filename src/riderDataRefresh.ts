export const riderDataRequestTimeoutMs = 15_000;

type RiderPanelTasks = {
  shift: () => Promise<void>;
  slots: () => Promise<void>;
  statistics: () => Promise<void>;
  cashWallet: () => Promise<void>;
};

/** Each panel applies its own response immediately; one failed panel cannot hide a shift closure. */
export function refreshRiderDataPanels(tasks: RiderPanelTasks) {
  return Promise.allSettled(Object.values(tasks).map((task) => Promise.resolve().then(task)));
}
