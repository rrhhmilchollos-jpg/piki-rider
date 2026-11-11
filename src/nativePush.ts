import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { prepareRiderNativeChannels } from "./riderNativeNotifications";
let epoch = 0;
let cancelRegistration: (() => void) | undefined;

export function cancelRiderPushRegistration() { ++epoch; cancelRegistration?.(); cancelRegistration = undefined; }
/** True means the API acknowledged the token, not merely that Firebase registration started. */
export async function registerRiderPush(apiOrigin: string, accessToken: string, options: { requestPermission?: boolean } = {}): Promise<boolean> {
  cancelRiderPushRegistration();
  const current = epoch;
  if (!Capacitor.isNativePlatform() || !accessToken.trim()) return false;
  try {
    let permission = await PushNotifications.checkPermissions();
    if (current !== epoch) return false;
    if (options.requestPermission && (permission.receive === "prompt" || permission.receive === "prompt-with-rationale")) {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted" || current !== epoch) return false;
    if (Capacitor.getPlatform() === "android") await prepareRiderNativeChannels();
    if (current !== epoch) return false;
    return await new Promise<boolean>((resolve) => {
      const handles: PluginListenerHandle[] = [];
      const abort = new AbortController();
      let done = false;
      let posting = false;
      const finish = (result: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        abort.abort();
        for (const handle of handles) void handle.remove();
        if (cancelRegistration === cancel) cancelRegistration = undefined;
        resolve(result);
      };
      const cancel = () => finish(false);
      cancelRegistration = cancel;
      const timer = setTimeout(cancel, 20_000);
      const add = async (handle: Promise<PluginListenerHandle>) => {
        const result = await handle;
        if (done) await result.remove(); else handles.push(result);
      };
      void (async () => {
        await add(PushNotifications.addListener("registration", ({ value }) => {
          if (done || posting || current !== epoch || !value) return;
          posting = true;
          void fetch(`${apiOrigin.replace(/\/$/, "")}/api/v1/push/native-subscriptions`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "X-PIKI-SURFACE": "rider" },
            body: JSON.stringify({ token: value, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android" }), signal: abort.signal,
          }).then((response) => finish(response.ok && current === epoch)).catch(() => finish(false));
        }));
        await add(PushNotifications.addListener("registrationError", () => finish(false)));
        if (!done && current === epoch) await PushNotifications.register(); else finish(false);
      })().catch(() => finish(false));
    });
  } catch {
    console.warn("PIKI push: registro nativo no disponible; no se ha confirmado recepción push.");
    return false;
  }
}
