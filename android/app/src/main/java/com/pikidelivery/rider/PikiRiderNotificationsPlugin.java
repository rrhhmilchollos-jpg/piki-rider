package com.pikidelivery.rider;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import java.util.HashSet;
import java.util.Set;

/** Notification audio only: no media player, volume control, DND bypass or full-screen intent. */
@CapacitorPlugin(name = "PikiRiderNotifications")
public class PikiRiderNotificationsPlugin extends Plugin {
    private final Set<Integer> orderIds = new HashSet<>();
    private final Set<Integer> alertIds = new HashSet<>();
    private final Set<Integer> arrivalIds = new HashSet<>();

    private String channelFor(String kind) {
        if ("shift".equals(kind)) return "piki_shift_start";
        if ("order".equals(kind)) return "piki_new_order_rider";
        if ("cancelled".equals(kind)) return "piki_order_cancelled";
        if ("arrived_store".equals(kind)) return "piki_arrived_store";
        if ("arrived_customer".equals(kind)) return "piki_arrived_customer";
        return null;
    }

    private String soundFor(String kind) {
        if ("shift".equals(kind)) return "start_shift";
        if ("order".equals(kind)) return "new_order_rider";
        if ("cancelled".equals(kind)) return "order_cancelled";
        if ("arrived_store".equals(kind)) return "arrived_store";
        if ("arrived_customer".equals(kind)) return "arrived_customer";
        return null;
    }

    private String titleFor(String kind) {
        if ("order".equals(kind)) return "Nueva oferta de reparto";
        if ("cancelled".equals(kind)) return "Pedido cancelado";
        if ("arrived_store".equals(kind)) return "Llegada al comercio";
        if ("arrived_customer".equals(kind)) return "Llegada al cliente";
        return "Jornada iniciada";
    }

    private boolean ensureChannel(String kind) {
        String channelId = channelFor(kind);
        String sound = soundFor(kind);
        if (channelId == null || sound == null) return false;
        int resource = getContext().getResources().getIdentifier(sound, "raw", getContext().getPackageName());
        // Do not create an immutable silent channel before the real WAV arrives.
        if (resource == 0) {
            if (BuildConfig.DEBUG) Log.d("PikiNotifications", "resource_pending:" + sound);
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return false;
            // Never delete/recreate or override an existing user's channel settings.
            if (manager.getNotificationChannel(channelId) == null) {
                String name = "shift".equals(kind) ? "Inicio de jornada" : "order".equals(kind) ? "Nuevas ofertas de reparto" : titleFor(kind);
                NotificationChannel channel = new NotificationChannel(channelId, name, NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Avisos operativos PIKI. Sonido y vibración sujetos a tus ajustes de Android.");
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
                // Stable resource-name URI survives numeric resource-ID changes in upgrades.
                channel.setSound(Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/" + sound), attributes);
                channel.enableVibration(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
                manager.createNotificationChannel(channel);
            }
        }
        return true;
    }

    @Override public void load() {
        ensureChannel("shift");
        ensureChannel("order");
        ensureChannel("cancelled");
        ensureChannel("arrived_store");
        ensureChannel("arrived_customer");
    }

    @PluginMethod public void prepareChannels(PluginCall call) {
        JSObject result = new JSObject();
        result.put("shift", ensureChannel("shift"));
        result.put("order", ensureChannel("order"));
        result.put("cancelled", ensureChannel("cancelled"));
        result.put("arrived_store", ensureChannel("arrived_store"));
        result.put("arrived_customer", ensureChannel("arrived_customer"));
        call.resolve(result);
    }

    @PluginMethod public void show(PluginCall call) {
        String kind = call.getString("kind", "");
        Integer id = call.getInt("id");
        long now = System.currentTimeMillis();
        Double expiresAt = call.getDouble("expiresAt");
        boolean consent = call.getBoolean("consent", false);
        if (!consent || id == null || id < 830000 || id > 929999 || expiresAt == null
            || !Double.isFinite(expiresAt) || expiresAt <= now || !ensureChannel(kind)
            || !NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            JSObject result = new JSObject(); result.put("scheduled", false); call.resolve(result); return;
        }
        long lifetime = Math.min(15000L, (long) (expiresAt - now));
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channelFor(kind))
            .setSmallIcon(getContext().getApplicationInfo().icon)
            .setContentTitle(titleFor(kind))
            .setContentText("arrived_store".equals(kind) ? "Proximidad al comercio. Confirma la recogida con el flujo de PIKI."
                : "arrived_customer".equals(kind) ? "Proximidad al cliente. La entrega requiere su QR o PIN."
                : "Abre PIKI Riders para consultar el estado actualizado.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true).setAutoCancel(true).setTimeoutAfter(lifetime);
        if (intent != null) builder.setContentIntent(PendingIntent.getActivity(getContext(), id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setSound(Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/" + soundFor(kind)));
            builder.setVibrate(new long[] { 0, 180, 100, 180 });
        }
        try {
            NotificationManagerCompat.from(getContext()).notify(id, builder.build());
            alertIds.add(id);
            if ("order".equals(kind)) orderIds.add(id);
            if ("arrived_store".equals(kind) || "arrived_customer".equals(kind)) arrivalIds.add(id);
            JSObject result = new JSObject(); result.put("scheduled", true); call.resolve(result);
        } catch (SecurityException exception) {
            // Revoked POST_NOTIFICATIONS is not a reason to force a permission prompt.
            JSObject result = new JSObject(); result.put("scheduled", false); call.resolve(result);
        }
    }

    @PluginMethod public void retainOrders(PluginCall call) {
        JSONArray keep = call.getArray("ids");
        Set<Integer> retained = new HashSet<>();
        if (keep != null) for (int i = 0; i < keep.length(); i++) retained.add(keep.optInt(i, -1));
        NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
        for (Integer id : new HashSet<>(orderIds)) {
            if (!retained.contains(id)) { manager.cancel(id); orderIds.remove(id); alertIds.remove(id); }
        }
        call.resolve();
    }

    @PluginMethod public void retainArrivals(PluginCall call) {
        JSONArray keep = call.getArray("ids");
        Set<Integer> retained = new HashSet<>();
        if (keep != null) for (int i = 0; i < keep.length(); i++) retained.add(keep.optInt(i, -1));
        NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
        for (Integer id : new HashSet<>(arrivalIds)) {
            if (!retained.contains(id)) { manager.cancel(id); arrivalIds.remove(id); alertIds.remove(id); }
        }
        call.resolve();
    }

    @PluginMethod public void clearAlerts(PluginCall call) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
        for (Integer id : new HashSet<>(alertIds)) manager.cancel(id);
        alertIds.clear();
        orderIds.clear();
        arrivalIds.clear();
        call.resolve();
    }
}
