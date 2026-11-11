# Correcciones nativas Rider

- [x] Corregir cancelación de recordatorios al vaciar calendario, cerrar sesión o revocar consentimiento; serializar operaciones y validar fechas Madrid, sin prometer entrega exacta.
- [x] Enlazar canales Android a start_shift.wav, new_order_rider.wav y order_cancelled.wav aportados por el padre, sin borrar canales ni alterar silencio/DND/volumen del sistema.
- [x] Utilizar GPS nativo real en validación de inicio y entrega; rechazar timestamps inválidos y posiciones simuladas; preservar gates existentes.
- [x] Corregir permiso QR/servicio Android y regresiones concretas de mapa/métricas sin añadir precios o capacidad inventados.
- [x] Ejecutar diagnóstico y pruebas locales con mocks y registrar logs.
- [ ] Compilar plugin Java y manifest fusionado con SDK Android, validar en móvil real y distribuir un nuevo artefacto firmado: reservado al padre. Los AAB anteriores no contienen estos cambios.

Firma, GitHub y publicación pertenecen al padre. No se modifica .github, secretos ni scripts de firma. No se lanzan servicios ni navegador. Logs locales: docs/native-validation/. Informe solicitado: /home/ubuntu/piki-expansion/rider-nativo.md.
