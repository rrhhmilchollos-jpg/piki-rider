import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pikidelivery.rider",
  appName: "PIKI Riders",
  webDir: "dist",
  android: {
    useLegacyBridge: true,
  },
  server: {
    iosScheme: "https",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
