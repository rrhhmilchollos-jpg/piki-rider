import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pikidelivery.rider",
  appName: "PIKI Rider",
  webDir: "dist",
  android: {
    // El rastreo nativo usa este bridge para conservar los callbacks tras 5 min en segundo plano.
    useLegacyBridge: true,
  },
};

export default config;
