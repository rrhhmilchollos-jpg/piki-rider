/**
 * Registro del token FCM en la app nativa del Rider.
 *
 * La app no recibía avisos del servidor porque nunca obtenía un token de
 * Firebase. Aquí se piden permisos, se registra el dispositivo y se envía el
 * token a la API con la sesión del Rider. Todo fallo se muestra en pantalla
 * mientras ponemos en marcha el canal: un registro silencioso impedía saber por
 * qué el contador de suscripciones seguía en cero.
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

type RegistrationPayload = { token: string; platform: "android" | "ios" };

const PREFIX = "PIKI push";

function notifyDevice(message: string): void {
  console.warn(`${PREFIX}: ${message}`);
  try {
    window.alert(`${PREFIX}: ${message}`);
  } catch {
    /* entorno sin diálogos */
  }
}

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
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      notifyDevice(`el servidor rechazó el token (HTTP ${response.status}) ${detail.slice(0, 120)}`);
      return false;
    }
    notifyDevice("token registrado correctamente en el servidor");
    return true;
  } catch (error) {
    notifyDevice(`no se pudo enviar el token: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function registerRiderPush(apiOrigin: string, accessToken: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    notifyDevice("esta pantalla no es la app nativa (modo navegador)");
    return false;
  }
  if (!accessToken) {
    notifyDevice("no hay sesión activa al registrar el token");
    return false;
  }
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
      notifyDevice(`permiso de notificaciones ${permission.receive}; actívalo en los ajustes de Android`);
      return false;
    }

    await PushNotifications.removeAllListeners();
    PushNotifications.addListener("registration", ({ value }) => {
      if (!value) {
        notifyDevice("Firebase devolvió un token vacío");
        return;
      }
      void postToken(apiOrigin, accessToken, {
        token: value,
        platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
      });
    });
    PushNotifications.addListener("registrationError", (error) => {
      notifyDevice(`Firebase rechazó el registro: ${JSON.stringify(error).slice(0, 160)}`);
    });
    await PushNotifications.register();
    return true;
  } catch (error) {
    // Sin google-services.json el plugin no inicializa; la app debe seguir usable
    // porque las alarmas locales de jornada no dependen de FCM.
    notifyDevice(`registro no disponible: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
