package com.pikidelivery.rider;

import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PikiGpsDiagnostics")
public class PikiGpsDiagnosticsPlugin extends Plugin {
    private static final String TAG = "PikiGps";
    private static final long STARTED_AT_MS = SystemClock.elapsedRealtime();

    @PluginMethod
    public void event(PluginCall call) {
        if (BuildConfig.DEBUG) {
            String event = call.getString("event", "");
            if (isAllowedEvent(event)) {
                long elapsedMs = SystemClock.elapsedRealtime() - STARTED_AT_MS;
                Log.d(TAG, event + " t+" + elapsedMs + "ms");
            }
        }
        call.resolve();
    }

    private boolean isAllowedEvent(String event) {
        return "watch_start".equals(event)
            || "watch_stop".equals(event)
            || "fix_received".equals(event)
            || "send_ack".equals(event)
            || "send_error".equals(event);
    }
}
