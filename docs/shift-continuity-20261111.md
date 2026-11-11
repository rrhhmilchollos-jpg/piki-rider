# Corrección de continuidad de jornada — 11/11/2026

La interfaz de Rider podía apagar el GPS después de confirmar el inicio porque dos consultas independientes aplicaban respuestas antiguas. También podía cancelar el inicio mientras el usuario aceptaba permisos o esperaba una posición GPS: cada respuesta de turno no activo incrementaba la generación del GPS, incluso si aún no había una jornada iniciada. Esto reproduce un fallo del cliente, pero no identifica por sí solo el incidente de una cuenta concreta.

## Cambios

La jornada ahora se sincroniza por una única carga serializada, con el sondeo existente de cinco segundos y recuperación al volver a la aplicación. Una barrera invalida las lecturas iniciadas antes o durante el inicio de jornada. El cierre se aplica únicamente sobre una respuesta completa y vigente del servidor; los bloqueos de cuenta y cierres oficiales siguen respetándose. Se comprueba la identidad de nuevo después de leer el cuerpo JSON del turno.

La respuesta de jornada se aplica sin esperar al calendario, las estadísticas ni la cartera. Cada panel tiene su propio manejo de fallo y las peticiones tienen un timeout de quince segundos. Un JSON inválido o un panel lento no oculta un cierre oficial ni deja indefinidamente bloqueada la carga serializada.

El contrato recibido se valida antes de sustituir el turno. Un cuerpo incompleto no se convierte en cierre de jornada. En el contrato actual, `shift` puede mostrar un turno futuro: se exige también `eligible` para considerarlo vigente. Se conservan los horarios asignados por Fleet y el formato 24 horas, incluido `12:00`–`00:00`; el cliente no crea turnos ni elimina cuotas contractuales.

El GPS web y Android comparten la detección de errores de autenticación explícitos. Una página genérica HTTP 401 del proxy no detiene para siempre el proveedor: el siguiente fix real puede reintentar. Una sesión invalidada explícitamente o una denegación operativa `RIDER_ACCESS_DENIED` sí detienen el GPS. No se fabrican coordenadas, timestamps ni confirmaciones de disponibilidad.

## Validación local

`pnpm run check`, `pnpm test`, `pnpm run lint` y `pnpm run build` completados. La suite del frontend pasa 217 pruebas: 195 existentes y 22 adicionales. Lint conserva tres advertencias preexistentes y cero errores. El build conserva la advertencia previa sobre tamaño de bundle. No se ejecutaron peticiones autenticadas, cambios de cuentas, pedidos ni escrituras en bases de datos de producción.

## Pendientes de producción

El barrido de la API puede revocar sesiones según un plan semanal que no coincide con los slots fechados. La corrección de Rider no neutraliza una revocación real del servidor: la API debe desplegar su corrección de calendario, reloj y cómputo semanal. No se deben relajar límites de contrato para mantener una conexión artificialmente.

Los horarios diarios de 12:00 a 00:00 pueden describir la ventana de servicio. No significan que cada trabajador tenga autorización para 84 horas semanales: los turnos y las cuotas de cada cuenta siguen siendo responsabilidad de Fleet.

También requiere una decisión separada el seguimiento de entregas que cruzan el fin de turno: el contrato actual de `/shift` y `/session` difiere en ese borde. Esta corrección no extiende silenciosamente la jornada ni habilita ofertas fuera del intervalo.

Antes de declarar resuelto el incidente real se deben revisar los motivos de corte `fuera_de_tramo`, `jornada_completa` o `plan_invalido` en los logs de la API y probar una cuenta de ensayo con horario conocido, incluyendo suspensión/reanudación y 23:59→00:00. Esas comprobaciones no se realizaron en esta preparación.

El 11/11/2026 se observó públicamente `rider.pikidelivery.com/release.json` con build `e2f272412ba4`. El dominio plural `riders.pikidelivery.com` devolvió HTTP 503 con aviso de servicio suspendido; no se cambió dominio ni DNS.
