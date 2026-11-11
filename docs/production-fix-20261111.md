# PIKI Rider — corrección 11/11/2026

Se corrigen la recuperación de ofertas con deadline único, alertas por _id, ofertas pendientes visibles junto a pedidos asignados, conservación de tarjetas ante errores, reintento REST real y watchdog SSE. GPS stationary adquiere fixes nuevos reales, sin reenviar coordenadas guardadas ni fabricar ACK. Android distanceFilter=0; PWA captura cada30s solo visible, envío limitado25m/60s y timestamps originales del provider.

Validado: TypeScript,95 regresiones frontend, build web, cap sync e identidad sincronizada;50 regresiones de identidad/firma/workflows. Icono canónico Play y nombre PIKI Riders. Se preservan applicationId com.pikidelivery.riders, namespace Java com.pikidelivery.rider y versionCode12. Release necesita certificado/keystore existentes y código superior al máximo Play; no se generó clave ni AAB ni se subió a Play.

Pendientes: GPS físico stationary/movimiento, consumo batería, Doze/OEM/pantalla apagada, gestos/scroll y E2E de pago/cocina/aceptación/recogida/entrega. El hook legado de ubicación de pedido on_the_way conserva un watcher adicional: no se afirma unicidad GPS global.
