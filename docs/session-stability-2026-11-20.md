# Estabilidad de sesión Rider — 20 de noviembre de 2026

Corrección focalizada sobre `dc5c89c`, orientada a no interrumpir la jornada de Jackson de 19:30–23:00 en Algemesí. Esta referencia identifica el contexto operativo; no se han consultado ni cambiado su cuenta, turno, pedidos o datos reales.

## Cambios

**Notificaciones PWA (P1).** `public/sw.template.js` y su copia servida `public/sw.js` envían `PIKI_NOTIFICATION_INTENT` y enfocan un cliente del mismo origen, dando prioridad al que ya tiene el foco. No llaman a `navigate`, no recargan ni abren otra ventana cuando existe un cliente, incluso si el mensaje o el foco fallan. Sólo sin cliente se usa `openWindow`, con un destino validado del mismo origen y fallback `/`.

El handler montado en `RiderWorkspace` muestra un aviso genérico mediante el toast existente, sin seguir la ruta de la notificación ni modificar token, sección, turno, pedido, scanner, formulario o mutación. Si ya hay un mensaje operativo, se conserva. No se añadieron navegación, lecturas API ni acciones de pedido al click.

**SSE (P1).** `connectPikiRealtime` recupera inmediatamente el bucle existente ante `online` o `visibilitychange` a visible, siempre que haya conectividad. Aborta el transporte anterior o despierta su espera de backoff; no inicia un segundo bucle. Coalesce eventos de recuperación próximos durante un segundo. Mantiene deadlines, heartbeats, backoff normal y clasificación estricta de errores de autenticación. El cierre explícito y los errores terminales retiran listeners y temporizadores.

El cursor `Last-Event-ID` vive exclusivamente en la instancia de conexión: se conserva en sus reconexiones y se reinicia al crear una nueva conexión, incluyendo cambio de token/Rider. Ya no se lee ni escribe la clave compartida de `sessionStorage`; no se almacena el bearer, ni como clave ni como valor, en este mecanismo.

**Actualización automática.** Los intentos de un mismo build tienen backoff de 1, 2, 4 y luego 5 minutos entre inicios, en lugar de reiniciarse cada 250 ms tras fallar. Un build distinto inicia una secuencia nueva. Antes del intento se revalida conectividad, ausencia de transacción concurrente y seguridad operativa conocida/inactiva; los intentos aplazados no consumen backoff. `online` permite reconsiderar un intento aplazado sin omitir el backoff. Las protecciones existentes siguen vigentes durante registro, activación y fallback.

## Evidencia local

- `pnpm check`: correcto antes y después; usado como fallback de diagnóstico al no estar disponible el MCP webdev de diagnósticos.
- Pruebas focalizadas: 9 archivos, 287 casos correctos (`realtime`, `riderServiceWorkerSafety`, `riderNotificationIntent`, `pikiRelease`, `pwaOperationSafety`, `pwaUpdateRecovery`, `riderAppSessionResilience`, `riderAppMutationIsolation`, `riderSessionLogout`).
- `pnpm test`: 59 archivos, 903 pruebas correctas, sin navegador ni I/O de producción.
- `git diff --check`: correcto.
- `pnpm lint`: 0 errores y 14 warnings. La misma configuración sobre copias temporales de los cinco archivos afectados por warnings en HEAD también devuelve 14 warnings; no se ampliaron ni corrigieron ajenos al alcance.

Las pruebas ejecutan el worker en VM y los efectos reales extraídos/componentes offline, con reloj falso y transportes mock. Cubren foco sin navegación, destinos externos, fallos de foco/mensaje, conservación del toast operativo, recuperación desde stream/fetch/espera, ráfagas visible+online, aislamiento del cursor, eliminación de listeners y backoff automático hasta su tope.

## Límites

No se ha usado navegador, producción, backend, commit, push, deploy, build de release, incremento de versión o `minimumVersion`, ni se ha forzado actualización durante turno. El código queda local, sin publicar; HEAD sigue en `dc5c89c`. No certifica el funcionamiento del dispositivo ni la elegibilidad de Jackson para asignaciones.

La corrección del click necesita que el worker corregido esté instalado y activado. Una instalación ya abierta con el worker anterior conserva su comportamiento hasta una distribución autorizada y una activación segura; no se fuerza aquí. Si la SPA todavía no está montada o el mensaje no se recibe, el foco sigue siendo útil y nunca se sustituye por recarga. El destino solicitado no se abre automáticamente en la SPA: el Rider revisa los avisos desde su pantalla conservada.

Se renuncia deliberadamente a persistir el cursor entre reloads/remontajes de la conexión. Los datos autoritativos siguen recuperándose con los GET/polling existentes; no se promete replay histórico de todos los mensajes efímeros al iniciar otra instancia. Las antiguas claves de cursor no se borran (ya no se consultan), para no introducir limpieza de almacenamiento de sesión.

No se modifica el registro push, el backend de eventos, el comportamiento GPS/Android nativo ni las reglas de autenticación. El backoff automático es local a la página y no persiste entre reloads. Los reintentos manuales mantienen su protección operativa actual.
