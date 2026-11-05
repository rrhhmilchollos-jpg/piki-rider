/**
 * Registro del token FCM en la app nativa del Rider.
 *
 * La app no podía recibir avisos del servidor porque nunca obtenía un token de
 * Firebase. Aquí se piden permisos, se registra el dispositivo y se envía el
 * token a la API con la sesión del Rider. Todo falla en silencio si el build no
 * lleva google-services.json, para no bloquear el acceso a la app.
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

type RegistrationPayload = { token: string; platform: "android" | "ios" };

async function postToken(apiOrigin: string, accessToken: string, payload: RegistrationPayload): Promise<boolean> {
  try {
    const response = await fetch(`${apiOrigin.replace(/\/$/, "")}/api/v1/push/native-subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-PIKI-SURFACE": "rider",
      },
      // El esquema de la API es estricto: solo token y platform.
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function registerRiderPush(apiOrigin: string, accessToken: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !accessToken) return false;
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") return false;

    await PushNotifications.removeAllListeners();
    PushNotifications.addListener("registration", ({ value }) => {
      if (!value) return;
      void postToken(apiOrigin, accessToken, {
        token: value,
        platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
      });
    });
    PushNotifications.addListener("registrationError", (error) => {
      console.warn("FCM registration error", error);
    });
    await PushNotifications.register();
    return true;
  } catch (error) {
    // Sin google-services.json el plugin no inicializa; la app debe seguir usable
    // porque las alarmas locales de jornada no dependen de FCM.
    console.warn("Push registration unavailable", error);
    return false;
  }
}
