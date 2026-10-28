import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pikidelivery.rider",
  appName: "PIKI Riders",
  webDir: "dist",
  server: {
    iosScheme: "https",
    cleartext: false,
  },
};

export default config;
