import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Debe coincidir exactamente con la ficha existente "PIKI Riders" en Google Play.
  appId: "com.pikidelivery.riders",
  appName: "PIKI Riders",
  webDir: "dist",
  android: {
    // El rastreo nativo usa este bridge para conservar los callbacks tras 5 min en segundo plano.
    useLegacyBridge: true,
  },
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
