# PIKI Rider: GPS Android, escala realtime y APK firmado

## 1. Auditoría del servicio GPS en segundo plano

La aplicación ya usa `@capacitor-community/background-geolocation` 1.3.1 y el servicio Android está declarado como `foregroundServiceType="location"`. También tiene `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK`, notificación persistente y `useLegacyBridge: true`. El heartbeat web/native se ha reducido a 30 segundos, con un margen amplio frente al guard del API de 90 segundos.

Se ha reforzado el manifiesto con:

- `ACCESS_BACKGROUND_LOCATION`, necesario para el seguimiento cuando la aplicación no está visible en Android 10+.
- `android:stopWithTask="false"`, para que retirar la tarea de recientes no detenga deliberadamente el servicio foreground.

Esto no puede anular las políticas de ahorro de batería de cada fabricante. En dispositivos de gama baja el operador debe completar, una vez por Rider, estos pasos:

1. Conceder ubicación **Precisa** y seleccionar **Permitir todo el tiempo** cuando Android lo ofrezca. Si Android solo muestra “Mientras se usa”, conceder primero ubicación precisa y después activar “Permitir todo el tiempo” desde Ajustes > PIKI Riders > Permisos > Ubicación.
2. Conceder notificaciones. La notificación permanente del servicio foreground no debe bloquearse.
3. En Ajustes > Batería > PIKI Riders, elegir **Sin restricciones** o **No optimizar**.
4. En Xiaomi/MIUI/HyperOS: activar Inicio automático, quitar restricciones de batería y bloquear PIKI Riders en recientes.
5. En Huawei: activar Inicio automático manual, ejecución secundaria y ejecución en segundo plano.
6. En Samsung: añadir PIKI Riders a “Aplicaciones que nunca se suspenden”.
7. En Oppo/Realme/Vivo/OnePlus: activar inicio automático y permitir actividad en segundo plano.
8. No cerrar la notificación de “Seguimiento de jornada” mientras el Rider esté online.

La app debe mostrar un estado operativo claro: `GPS activo`, `permiso en segundo plano pendiente`, `optimización de batería pendiente`, `GPS degradado` o `GPS detenido`. Si el usuario revoca el permiso o fuerza la detención de la app, ningún servicio Android puede garantizar continuidad; el backend debe conservar la jornada y marcar el GPS como degradado, no cerrar la jornada automáticamente.

## 2. Capacidad para más de 1000 Riders

### Hallazgos actuales

- Mongoose usa `maxPoolSize: 20` y `minPoolSize: 2` por proceso. Es un valor prudente para una sola instancia, pero no es una capacidad nacional garantizada.
- El realtime usa un `EventEmitter` local, persistencia MongoDB en `RealtimeEvent` y Change Streams para distribuir eventos entre instancias. Esto evita perder eventos durante un reinicio, pero cada evento normal realiza una escritura MongoDB y el fan-out de localización puede multiplicarse por audiencia.
- Las posiciones de Rider se agrupan en ventanas de 5 segundos durante una entrega y se escriben como eventos para Fleet/Admin/Customer. El GPS de 1000 Riders cada 30 segundos supone aproximadamente 33 actualizaciones por segundo antes de contar reintentos; con 1000 entregas activas y fan-out a tres audiencias, el volumen de eventos persistidos puede ser varios cientos por segundo.
- El algoritmo de dispatch consulta Riders disponibles, slots y geolocalización; existen índices `2dsphere` y varios índices operativos, pero hay consultas que recuperan listas de Riders y cuentan/filtran en la aplicación.
- El relay de Change Streams y el fallback inline son correctos como tolerancia, pero deben evitarse duplicados de workers en escalado horizontal usando leases y una única política de ejecución.

### Arquitectura recomendada

1. **Separar planos de datos.** MongoDB conserva pedidos, asignaciones, auditoría y el último estado GPS. Redis/KeyDB administrado maneja presencia efímera (`rider:{id}:presence`), posición reciente con TTL, locks de dispatch y pub/sub. No guardar cada heartbeat GPS como documento histórico salvo que haya pedido activo, incidente o requisito legal.
2. **Usar un gateway realtime dedicado.** Mantener SSE/WebSocket en un proceso/servicio especializado con conexiones persistentes. El API transaccional publica eventos en Redis Streams o Pub/Sub; los gateways consumen y distribuyen a los clientes. MongoDB queda para replay corto, no para cada mensaje de fan-out.
3. **Aplicar backpressure.** Una cola por conexión, límite de eventos pendientes y coalescing de `rider.location_updated`: conservar solo la posición más reciente por `orderId`/audiencia. Los eventos de estado, aceptación, soporte y pagos nunca deben coalescerse.
4. **Separar ubicación de eventos de negocio.** Publicar posiciones a 5–10 segundos solo para clientes autorizados con entrega activa; Fleet/Admin puede recibir agregados por lote. El cliente final debe recibir la cadencia necesaria para UX, no el heartbeat interno de 30 segundos.
5. **Indexar según las consultas reales.** Mantener y revisar con `explain("executionStats")` índices compuestos para:
   - `orders`: `{ tenantId, riderId, assignmentState, status }`, `{ tenantId, assignmentState, status, assignmentExpiresAt }` y geolocalización de `restaurantId`/`deliveryLocation` cuando proceda.
   - `riders`: `{ tenantId, status, lifecycleStatus, lastLocationAt }` y el `2dsphere` existente.
   - `rider_slots`: `{ tenantId, riderId, date, status }` además del índice único actual.
   - `realtime_events`: `{ channel, audienceKey, tenantId, _id }` y TTL de retención corta si el producto no necesita histórico largo.
   - `dispatch_outbox`: `{ status, availableAt, leaseUntil }` ya declarado; medir que la consulta de lease usa ese índice.
6. **Pool y límites.** Medir conexiones reales por instancia antes de aumentar `maxPoolSize`. Como punto de partida, usar 50–100 conexiones por instancia solo si el clúster Mongo y el límite total lo soportan; con 4 instancias serían 200–400 conexiones. Configurar `waitQueueTimeoutMS`, `maxConnecting` y timeouts para fallar rápido, y reservar capacidad para operaciones administrativas.
7. **Dispatch por particiones.** Particionar el outbox por `tenantId`/zona o usar varios workers con leases atómicos. Cada worker debe procesar lotes pequeños, no ejecutar scans globales. Mantener idempotency keys y `findOneAndUpdate` condicionales.
8. **Load test antes de abrir cobertura nacional.** Simular 1000 conexiones Rider, 1000 heartbeats cada 30 s, 100 entregas activas y picos de creación de pedidos. Medir p95/p99 de GPS, aceptación, SSE, Mongo pool wait, CPU, memoria, operaciones/s, lag del Change Stream, tamaño del outbox y reconnect rate. No declarar capacidad solo porque `/health` responda.
9. **Observabilidad obligatoria.** Métricas por instancia y tenant: conexiones activas, eventos/s, bytes/s, backlog por conexión, Mongo pool checked-out/available, latencia de query, Change Stream lag, dispatch queue age, GPS freshness y 409/503. Alertar si p99 GPS > 3 s, backlog > 100, pool wait > 250 ms o más del 1% de Riders supera 90 s.

### Orden de ejecución recomendado

- Fase A: índices y `explain`, métricas y límites de SSE existentes.
- Fase B: Redis presence/pub-sub y coalescing de posiciones.
- Fase C: gateway realtime horizontal y replay corto.
- Fase D: prueba de carga sostenida y prueba de fallo de instancia.
- Fase E: aumentar capacidad Render/Mongo solo con métricas, no por estimación.

No conviene subir `maxPoolSize` ni activar más instancias a ciegas: eso puede trasladar el cuello de botella a MongoDB y provocar saturación de conexiones.

## 3. Compilar y firmar el APK

### Requisitos

- Node >= 22.12 y pnpm 10.4.1.
- JDK 21 y Android SDK con `platforms;android-36` y build-tools que incluyan `apksigner` y `aapt2`.
- La **keystore de subida existente** de PIKI. Nunca se debe crear otra para sustituirla.
- El valor exacto del certificado de subida de Play y el máximo `versionCode` utilizado en todas las pistas.

### Variables protegidas

Configurar en el entorno local o en el secreto del CI, nunca en Git:

```bash
export PIKI_SIGNING_STORE_FILE=/ruta/protegida/piki-upload.jks
export PIKI_SIGNING_STORE_PASSWORD='...'
export PIKI_SIGNING_KEY_ALIAS='...'
export PIKI_SIGNING_KEY_PASSWORD='...'
export PIKI_EXPECTED_UPLOAD_CERT_SHA256='AA:BB:...:FF'
export PIKI_PLAY_MAX_VERSION_CODE='12'
export ANDROID_HOME="$HOME/Android/Sdk"
```

`PIKI_PLAY_MAX_VERSION_CODE` debe ser el máximo real de Google Play. El `versionCode` de `android/app/build.gradle` tiene que ser estrictamente mayor; el proyecto bloquea el release si no lo es. No se incrementa automáticamente porque inventar ese valor puede romper una publicación existente.

### Ejecución local

Desde la raíz de `piki-rider`:

```bash
chmod 700 scripts/build-signed-apk.sh
./scripts/build-signed-apk.sh
```

El script instala dependencias fijadas, ejecuta typecheck y tests, genera el bundle web, sincroniza Capacitor, valida identidad Android, verifica la keystore existente, compila `assembleRelease` y comprueba con `apksigner` que el APK usa el certificado esperado. No imprime contraseñas, no crea keystores y no sube nada a Google Play.

Salida esperada:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Para instalarlo en un dispositivo de prueba autorizado:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys package com.pikidelivery.riders | grep -E 'versionCode|versionName'
```

En un APK de producción distribuido por Play no se debe usar `adb install` como sustituto de la publicación. La publicación debe seguir el flujo de revisión de Play.

### Flujo CI recomendado

El repositorio ya contiene `.github/workflows/android.yml`. En `main`, el workflow:

1. Ejecuta tests y validaciones.
2. Comprueba identidad Android sincronizada.
3. Materializa temporalmente la keystore desde un secreto Base64 con permisos `0600`.
4. Genera y verifica el AAB firmado.
5. Genera el APK firmado y su metadata.
6. Elimina la keystore temporal aunque falle el job.
7. Guarda los artefactos verificados; no los sube automáticamente a Play.

El APK debe publicarse posteriormente desde el canal interno de Play con revisión humana del commit, `versionCode`, hash y certificado. No se deben guardar archivos `.jks`, contraseñas, `google-services.json` privado ni APKs firmados en el repositorio.

### Verificación en dispositivo

Después de instalar la nueva versión, comprobar en un dispositivo de gama baja:

1. Permisos precisos y “todo el tiempo”.
2. Notificación de seguimiento visible.
3. Estado de batería sin restricciones.
4. Inicio de jornada dentro de un slot.
5. Bloqueo de pantalla durante al menos 15 minutos.
6. App retirada de recientes sin detener el servicio.
7. `lastLocationAt` actualizado y ACK HTTP válido.
8. Reconexión tras perder red.
9. Cierre normal de jornada y detención explícita del tracker.

La prueba de aceptación es que un fallo temporal de red o la suspensión de la UI no cierre la jornada; solo una detención explícita, revocación de permisos o cierre de sesión debe detener el tracking.
