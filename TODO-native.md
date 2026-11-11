# Correcciones nativas Rider

- [x] Corregir cancelación de recordatorios al vaciar calendario, cerrar sesión o revocar consentimiento; serializar operaciones y validar fechas Madrid, sin prometer entrega exacta.
- [x] Enlazar canales Android a start_shift.wav, new_order_rider.wav y order_cancelled.wav aportados por el padre, sin borrar canales ni alterar silencio/DND/volumen del sistema.
- [x] Utilizar GPS nativo real en validación de inicio y entrega; rechazar timestamps inválidos y posiciones simuladas; preservar gates existentes.
- [x] Corregir permiso QR/servicio Android y regresiones concretas de mapa/métricas sin añadir precios o capacidad inventados.
- [x] Ejecutar diagnóstico y pruebas locales con mocks y registrar logs.
- [x] Añadir piki_arrived_store/arrived_store.wav y piki_arrived_customer/arrived_customer.wav reales. Señales finitas con consentimiento/permiso OS y silencio/DND/canales respetados; sin reproducción WebView, bucles ni volumen forzado.
- [x] Detectar entrada en proximidad solo para el pedido asignado activo y su fase, con el fix nativo real/reciente que obtuvo ACK operacional, precisión válida y coordenadas auténticas del pedido. Sin watcher paralelo ni confirmación automática de recogida/entrega; QR/PIN y gates siguen intactos. Consumir una vez por pedido/fase, sin replay en montaje/reconexión; invalidar cola y retirar avisos al cancelar/logout/cambiar pedido/fase/revocar consentimiento. Persistir únicamente marcadores de deduplicación, no GPS ni tokens.
- [ ] Verificar/exponer al Rider los radios efectivos de negocio, reservado al padre/API. La API local impone mínimo 30 m y default 80 m con overrides, pero offers/operational-map no exponen el valor efectivo. La detección local usa solo el mínimo conocido de 30 m y rechaza estimaciones ambiguas; no afirma cobertura hasta 80 m ni configuración live. El ACK de llegada al comercio ya existente puede aportar una señal autoritativa fresca adicional. No se añadió una API ni se cambiaron variables para resolverlo.
- [ ] Compilar el plugin Java modificado y manifest fusionado con SDK Android, validar ambos avisos en móvil real y distribuir un nuevo artefacto firmado: reservado al padre. No se ha ejecutado Gradle, cap sync, prepare-release ni firma en la tarea de llegadas.

Firma, GitHub y publicación pertenecen al padre. No se modifica .github, secretos ni scripts de firma. No se lanzan servicios ni navegador. Logs locales: docs/native-validation/. Informe previo: /home/ubuntu/piki-expansion/rider-nativo.md. Informe de llegadas: /home/ubuntu/piki-next/Rider_llegadas_audio.md.
