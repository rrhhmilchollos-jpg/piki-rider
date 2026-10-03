# PIKI Riders: viabilidad económica y riesgos de incentivos

**Fecha de análisis:** 2 de octubre de 2026

**Alcance:** garantía horaria y bonos de captación/referidos indicados por PIKI. No es asesoramiento laboral, fiscal ni jurídico.

## Conclusión ejecutiva

Los incentivos pueden servir como **piloto de liquidez y adquisición**, pero no se puede afirmar que sean rentables con los datos actuales: faltan margen de contribución por pedido, volumen esperado, porcentaje de turnos elegibles y presupuesto mensual. La garantía puede resultar costosa en horas ociosas; los referidos tienen coste previsible por activación, pero se adelantan antes de probar retención o valor de vida del rider.

La interpretación aplicada al código es la expresada en la propuesta: el rider cobra **el mayor** entre sus ganancias por entregas y el suelo elegible; no se suman €28 al pago de pedidos. Para un turno elegible de cuatro horas:

```text
complemento = max(0, €7 × 4 − ganancias por entregas ya calculadas para ese turno)
```

Con los valores del ejemplo, el compromiso máximo incremental por turno sin pedidos es **€28**. Un rider referido que alcanza 20 entregas activa, en conjunto, **€50** de bonos: €20 para el nuevo rider al completar 5 entregas, más €15 para cada parte al alcanzar 20. Ese incentivo equivale a €2,50 por cada una de las primeras 20 entregas como promedio acumulado, antes de la remuneración normal del rider y de otros costes.

**Recomendación:** no activar en producción hasta fijar margen unitario, calendario, tope de gasto global, reglas laborales y control antifraude. La implementación queda **apagada por defecto**, y las recompensas se contabilizan como devengadas, no como pagos bancarios ejecutados.

## Coste de cada incentivo

| Mecánica | Coste incremental con las cifras propuestas | Momento de devengo | Observaciones |
|---|---:|---|---|
| Garantía de 4 h sin pedidos | Hasta **€28 por turno** | Cuando se cumplen todos los requisitos | El coste baja por las ganancias de entregas que ya cubren el suelo. |
| Adquisición: primeras 5 entregas | **€20 por nuevo rider elegible** | Tras 5 entregas verificadas | Promedia €4 por entrega en los primeros cinco pedidos. |
| Plan Amigo: 20 entregas | **€15 al invitador + €15 al invitado** | Tras 20 entregas del nuevo rider | €30 por pareja referido–invitador, adicional al bono de €20. |
| Nuevo rider referido que llega a 20 | **€50 por adquisición completada** | €20 al pedido 5; €30 al pedido 20 | No incluye la tarifa normal de reparto, propinas, impuestos o cargas laborales. |

El incentivo total de €50 incluye la bonificación de adquisición de €20 más los dos bonos de referido de €15. Si una misma entrega participa también en un turno garantizado, el coste de captación y el complemento horario se acumulan.

## Escenarios sencillos

Los escenarios son aritmética de los importes propuestos, **no una previsión de pedidos ni un presupuesto aprobado**.

| Escenario ilustrativo | Coste de incentivos |
|---|---:|
| 10 turnos elegibles de 4 h sin pedidos | **€280** |
| 100 turnos elegibles de 4 h sin pedidos | **€2.800** |
| 10 riders referidos que completan 20 entregas cada uno | **€500** |
| 100 riders referidos que completan 20 entregas cada uno | **€5.000** |
| 100 referidos que alcanzan 20 entregas + 100 turnos vacíos | **€7.800** |
| 5 turnos vacíos de 4 h por semana | **€140/semana**; €7.280 si se repite 52 semanas |

La exposición de garantía depende de `turnos elegibles × complemento medio`, no solo del número de riders. El coste real del escenario “turno vacío” es un **techo**: si el pago por pedidos del turno asciende a €18, el complemento sería €10; si asciende a €28 o más, el complemento sería cero.

## Punto de equilibrio

Antes de incentivos y costes fijos, sea `C20` la contribución neta que generan los primeros 20 pedidos atribuibles a un nuevo rider, una vez pagada la remuneración de reparto ordinaria y otros costes variables. Para cubrir el coste de captación de un rider referido que llega a 20, se necesita:

```text
C20 ≥ €50 + complementos de garantía imputables a sus turnos
```

Si se distribuye el bono de €50 uniformemente, exige €2,50 de contribución incremental media por pedido durante esos primeros 20. Sin embargo, el bono de adquisición de €20 se activa ya al pedido 5; por eso, para recuperar ese pago solo con las primeras cinco entregas se necesitarían €4 de contribución por pedido, antes de contar el bonus del invitador y el del invitado.

Para cada turno garantizado, la contribución previa a incentivos debería cubrir:

```text
remuneración ordinaria por pedidos + max(0, suelo horario − remuneración de esos pedidos)
```

Con un turno sin pedidos, la línea incremental mínima es €28; con pedidos, el complemento disminuye euro por euro hasta cero. No se dispone de `C20`, del margen por pedido ni de la mezcla de distancias para calcular un ROI, CAC/LTV o plazo de recuperación fiable.

## Qué aporta ya el software y qué no

Se inspeccionaron `piki-rider`, `piki-api`, `piki-fleet` y `piki-admin` para evitar duplicar componentes existentes.

- **Reutilizado:** el cálculo de liquidación de `piki-api/src/settlements.ts`, que ya separa pago base, distancia, propinas e incentivos por pedido. La garantía se modela como complemento incremental; no crea otro motor de liquidación.
- **Reutilizado:** `dispatch_decisions`, el registro actual del despacho. Al aceptar, rechazar o dejar vencer una oferta, el backend actualiza el mismo evento y calcula aceptación sobre ofertas reales; 0 ofertas no penaliza.
- **Reutilizado:** las zonas geoespaciales existentes; el valor por defecto de piloto es `xativa-centro`.
- **Añadido:** pantalla **Incentivos** en Rider, atribución de códigos antes de la primera entrega, ledger idempotente, verificación de hitos y tope global mensual con reserva atómica. Los dos bonos de €15 se conceden juntos dentro de una transacción.
- **Todavía no es un pago bancario:** el ledger conserva saldo devengado/pendiente; no existe aquí una conexión de payout que transfiera estos importes. La cartera de efectivo de clientes no se reutiliza para este fin.
- **No activado:** ambas campañas están apagadas por defecto. Requieren activación expresa, fecha de inicio, tope mensual y configuración en el entorno del API. No se ha hecho despliegue ni publicación.

### Criterios técnicos de elegibilidad implementados para la garantía

El backend usa la hora del servidor, datos de pedidos confirmados, el motor de liquidación existente y las ofertas registradas. Para el piloto, pide un slot de exactamente 4 h, comienzo junto al inicio programado, finalización tras el fin del slot, cobertura GPS casi completa con huecos de máximo 90 s, permanencia observada en la zona central cuando el rider no está en un reparto, y aceptación de al menos el 95 % de ofertas (aceptadas / aceptadas + expiradas + rechazadas). Si no llega ninguna oferta, ese criterio pasa. Los umbrales de GPS son una decisión de producto provisional, no una regla comunicada al rider hasta validarlos.

La remuneración ordinaria por pedido se calcula con el baseline **actual del repositorio**, que usa €2,50 de base y €0,60 por km. El complemento se reduce solo por esa remuneración financiada por PIKI; **las propinas del cliente no se usan para rebajar el suelo**, aunque el motor de liquidación puede admitirlas como campo opcional. Si se introducen otros bonos financiados por PIKI, debe definirse por escrito si también reducen la garantía e integrarlos antes de la activación.

## Riesgos financieros y controles recomendados

1. **Demanda débil / turnos ociosos.** La garantía es una obligación por capacidad reservada aunque no haya ventas. Medir la tasa histórica de horas elegibles sin pedidos y la utilización de zona antes de prometer turnos.
2. **Márgenes de pedido insuficientes.** El coste fijo por rider referido puede exceder la contribución de los primeros 20 pedidos. No financiar el programa con GMV; usar margen después de pago del rider, comisiones, cobros, reembolsos, soporte, descuentos e impuestos aplicables.
3. **Selección adversa y aceptación insegura.** El 95 % puede empujar a aceptar pedidos largos, mal pagados o inseguros. Aclarar exclusiones legítimas (seguridad, errores de dirección, pedidos no compatibles, fraude, indisponibilidad técnica) y no penalizar negativas protegidas.
4. **Oferta “expirada” mal atribuida.** Una notificación tardía o caída de red no debería contar automáticamente como rechazo culpable. Auditar expiraciones y soporte; establecer un proceso de impugnación y medir falsos positivos.
5. **Fraude de referidos.** Se bloquea el autocódigo directo, se exige vínculo antes de la primera entrega y se premian solo pedidos entregados y no marcados de prueba. Aún faltan controles de duplicidad de identidad, dispositivos, teléfono, medio de cobro, domicilios y redes coordinadas; aplicar revisión de riesgo antes de liquidar y una política de reversos documentada.
6. **Presupuesto y concurrencia.** Hay un tope global mensual. Debe fijarse un importe de prueba que Finanzas pueda asumir; al agotarse no se deben aceptar nuevas obligaciones. El par €15/€15 se reserva y contabiliza junto.
7. **Reclamaciones y contabilidad.** “Devengado” no significa “pagado”. Definir calendario, revisión de incidencias, fiscalidad, registro contable de pasivo y conciliación con el payout antes de ofrecer el saldo como dinero disponible.
8. **Costes laborales y de Seguridad Social.** La tarifa de €7/h no debe tratarse como un coste total laboral ni como una forma de eludir mínimos salariales. No se especificó si son euros brutos o netos; el cálculo asume remuneración bruta del rider y excluye costes empresariales. El SMI español de 2026 es €1.221/mes y, en cómputo anual, no menos de €17.094 para jornada completa; la equivalencia horaria depende de la jornada anual y del régimen aplicable. Además, la Ley Rider contempla presunción de laboralidad cuando la plataforma dirige, organiza o controla el reparto mediante gestión algorítmica. Una garantía unida a turnos completos, zona y tasa de aceptación aumenta la necesidad de revisar la relación real, nómina/cotizaciones y reglas algorítmicas con asesoría laboral.
9. **Privacidad GPS.** El criterio depende de ubicación recurrente. Informar al rider de la finalidad, frecuencia, retención y uso; conservar métricas mínimas y no el historial detallado si no hace falta.

## Decisiones y datos pendientes para autorizar un piloto

- Margen neto medio por pedido y distribución por distancia/zona.
- Pedidos por hora, turnos de cuatro horas esperados y porcentaje de turnos que podrían satisfacer cada regla.
- Base/por-km/propina e incentivo que realmente recibe el rider (confirmar baseline €2,50 + €0,60/km).
- Fecha efectiva, zona exacta y tolerancias aceptables de conexión/GPS.
- Tope máximo mensual global, límite de participantes y mecanismo de pausa cuando el gasto comprometido se aproxime al tope.
- Protocolo para expiraciones de ofertas, seguridad, incidencias, revisiones y reversos.
- Validación laboral/fiscal y forma de pagar los saldos devengados.

## Fuentes oficiales

- [Real Decreto 126/2026 que fija el salario mínimo interprofesional para 2026 (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2026-3815): €1.221/mes, mínimo anual de €17.094 a jornada completa; la norma también especifica una tarifa horaria de €9,55 para empleo doméstico externo por horas, **no extrapolable automáticamente** a riders.
- [Ley 12/2021, disposición adicional 23.ª del Estatuto de los Trabajadores y art. 64.4.d (BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2021-15767): presunción de laboralidad en reparto bajo organización/dirección/control algorítmico, y derecho de información sobre parámetros, reglas e instrucciones algorítmicas que afecten a las condiciones de trabajo.

> La clasificación contractual y el SMI no pueden resolverse con este modelo de costes. Revisar con asesoría laboral española antes de ofrecer o activar una remuneración garantizada.
