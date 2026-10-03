# PIKI Rider 2.0 — plan de reconstrucción

## Alcance

Reconstruir la experiencia de PIKI Rider sobre el backend y contratos existentes, conservando autenticación, turnos, GPS, ofertas, transiciones de pedido, wallet, soporte e incentivos, pero sustituyendo la arquitectura visual actual por una interfaz móvil-first y operativa.

## Arquitectura de producto

- **Jornada**: pantalla principal de trabajo; mapa, estado online/offline, próximo turno, actividad y oferta/pedido activo.
- **Ofertas**: ofertas pendientes con pago, distancia, pickup, drop-off, efectivo y acción clara.
- **Entregas**: pedido activo con máquina de estados y acciones según estado.
- **Mapa**: mapa de cobertura, ubicación y zonas de demanda.
- **Horarios**: calendario de turnos, zona y check-in.
- **Cartera**: saldo en efectivo, ingresos, propinas, incentivos y próximos pagos.
- **Incentivos**: progreso, recompensas y misiones sin distraer durante la conducción.
- **Estadísticas**: entregas, aceptación, cancelaciones, valoración y distancia.
- **Soporte**: categorías contextuales, FAQ y chat/incidencia.
- **Cuenta**: perfil, vehículo, conexión, permisos y seguridad.

## Diseño

- **Movimiento**: Neo-utility editorial con lenguaje de dashboard de movilidad: negro azul profundo, superficies marfil, lima eléctrica para acción y coral para riesgo.
- **Principios**: una decisión por pantalla; datos grandes y escaneables; estados visibles; humor corto sin infantilizar; accesibilidad en movimiento.
- **Color**: `#0B1220` como “noche de ciudad”, `#E9FF62` como firma PIKI y acción segura, `#FF765D` para atención y `#F6F3EC` para descanso visual.
- **Layout**: escritorio con rail compacto y contenido asimétrico; móvil con bottom navigation, tarjetas apiladas y bottom sheets.
- **Firma visual**: píldoras de estado, línea de ruta punteada y tarjetas con “siguiente acción”.
- **Interacción**: los botones cambian con el estado del pedido; las acciones críticas son grandes; las notificaciones no cubren controles de terminar jornada.
- **Animación**: pulso suave en GPS/online, transición de tarjeta al recibir oferta, ningún movimiento continuo que distraiga mientras se conduce.
- **Tipografía**: sistema sans nativo para legibilidad; títulos condensados por peso y números tabulares para dinero/tiempos.
- **Esencia de marca**: “la app que convierte cada reparto en una ruta clara y justa”. Personalidad: directa, energética, humana.
- **Voz**: titulares como “Hoy rueda contigo” y “Tu siguiente parada está clara”; CTA como “Empezar jornada”, “Ver ruta” y “Confirmar recogida”.
- **Wordmark**: logotipo PIKI existente con marcador circular y pequeña muesca de ruta; no crear una marca paralela.
- **Color propio**: lima eléctrica `#E9FF62`.

## Implementación

- Reutilizar los handlers y fetches de `src/App.tsx` y los componentes de dominio existentes.
- Sustituir el shell visual, navegación y composición de la home mediante CSS y componentes de navegación, sin duplicar endpoints.
- Mantener fallback offline, auth gate y rutas de release.
- Añadir `public/manus-routes.json` con las vistas principales.
