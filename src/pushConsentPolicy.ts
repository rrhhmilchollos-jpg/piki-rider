export type NotificationPermissionState = "default" | "granted" | "denied";

export function shouldShowPushConsent({
  supported,
  authenticated,
  permission,
}: {
  supported: boolean;
  authenticated: boolean;
  permission: NotificationPermissionState;
}): boolean {
  return supported && authenticated && permission === "default";
}
