/// <reference types="node" />
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
describe("Android source contracts — not device tests", () => {
  it("registers native channels and closes the background GPS exported service", () => {
    expect(read("android/app/src/main/java/com/pikidelivery/rider/MainActivity.java")).toContain("registerPlugin(PikiRiderNotificationsPlugin.class)");
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toMatch(/<service[\s\S]*?BackgroundGeolocationService[\s\S]*?android:exported="false"[\s\S]*?tools:replace="android:exported"/);
    expect(manifest).toContain('android:name="android.permission.CAMERA"');
    expect(manifest).not.toContain("android.permission.RECORD_AUDIO");
    expect(manifest).not.toMatch(/uses-permission[^>]*ACCESS_BACKGROUND_LOCATION|uses-permission[^>]*USE_EXACT_ALARM/);
  });
  it("does not force audio volume, DND bypass, hardware buttons or fullscreen", () => {
    const java = read("android/app/src/main/java/com/pikidelivery/rider/PikiRiderNotificationsPlugin.java");
    expect(java).toContain("NotificationManager.IMPORTANCE_HIGH");
    expect(java).toContain("AudioAttributes.USAGE_NOTIFICATION");
    expect(java).toContain("setTimeoutAfter(lifetime)");
    expect(java).not.toMatch(/setStreamVolume|adjustStreamVolume|setBypassDnd|setFullScreenIntent|USAGE_ALARM|MediaPlayer|dispatchKeyEvent/);
  });
  it("real audio files supplied by the parent are present and have RIFF WAV headers", () => {
    for (const name of ["start_shift", "new_order_rider", "order_cancelled"]) {
      const path = new URL(`../android/app/src/main/res/raw/${name}.wav`, import.meta.url);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString()).toBe("RIFF");
    }
  });
  it("does not use a fabricated map position or parallel order geolocation watcher", () => {
    expect(read("src/components/LiveGoogleMap.tsx")).not.toContain("38.9887");
    expect(read("src/useRiderLocationPing.ts")).not.toContain("navigator.geolocation");
    expect(read("src/useRiderLocationPing.ts")).toContain("useRiderGpsMapPoint");
  });
});
