# PIKI Riders: impacto mensual para un piloto de 50 riders

**Base de cálculo:** importes del plan propuesto y baseline actualmente codificado en `piki-api/src/settlements.ts`. Es una sensibilidad, no un presupuesto aprobado ni una previsión de volumen.

## Resumen ejecutivo

El coste del **incentivo**, antes de considerar las ganancias normales por reparto, varía sobre todo con cuántos turnos de cuatro horas cumpla cada rider. Cada turno sin remuneración de pedidos puede requerir hasta **€28** de complemento. Si las entregas del turno generan pago financiado por PIKI, el complemento baja euro por euro hasta cero.

Para 50 riders, un escenario con **4 turnos elegibles por persona en el mes** tiene un techo horario de €5.600. Si los 50 son nuevos referidos, llegan a 20 entregas y cobran los hitos, se suman hasta €2.500 de bonos. El techo combinado de incentivos sería **€8.100**, pero sobrestima el coste horario si los riders realizaron entregas: las ganancias por pedidos reducen el complemento. No incluye las liquidaciones ordinarias, impuestos/cargas laborales, coste del equipo de calle, ni otros gastos.

## Sensibilidad del gasto de incentivos

Supuestos: los 50 son riders nuevos; `S` es el número medio de turnos elegibles de 4 h por rider en el mes. La columna de garantía presume **cero ingresos de reparto en cada turno**, por lo que es un techo y no un pronóstico. “Bono de 20 entregas” incluye también los €20 de adquisición que se devengan al hito de 5 entregas.

| Turnos elegibles por rider/mes | Turnos del grupo | Techo de garantía (28 € × turnos) | Si los 50 llegan a 5 entregas | Si los 50 son referidos y llegan a 20 |
|---:|---:|---:|---:|---:|
| 1 | 50 | €1.400 | €2.400 total | **€3.900 total** |
| 4 | 200 | €5.600 | €6.600 total | **€8.100 total** |
| 10 | 500 | €14.000 | €15.000 total | **€16.500 total** |
| 20 | 1.000 | €28.000 | €29.000 total | **€30.500 total** |

Los totales suman el techo de garantía y, según columna, €1.000 por 50 hitos de adquisición o €2.500 por 50 hitos completos de referido. Si parte de los riders no completa el hito, usar el número real de personas: `€20 × riders que llegan a 5 + €30 × referidos que llegan a 20`.

Cinco turnos por semana durante un mes promedio equivalen aproximadamente a 21,7 turnos por persona. Para 50 riders, eso da unas 1.083 oportunidades de turno: techo horario aproximado **€30.333** y hasta **€32.833** incluidos los bonos de 50 referidos que alcancen 20. El calendario real puede variar entre 20 y 22 turnos por persona.

## Liquidación ordinaria: va aparte del tope de incentivos

El código actual usa €2,50 de base y €0,60 por kilómetro para el rider. Si los 50 completan 20 entregas cada uno, son 1.000 entregas y, usando esa fórmula como referencia:

| Distancia media supuesta | Pago base + distancia para 1.000 entregas | Más €2.500 de bonos de 50 referidos a 20 entregas |
|---:|---:|---:|
| 3 km | €4.300 | **€6.800 + complementos horarios** |
| 5 km | €5.500 | **€8.000 + complementos horarios** |

Los 3 y 5 km son supuestos de sensibilidad, no datos de PIKI. Las propinas no se descuentan del suelo horario. El total real de flujo de caja también depende de la distancia real, de cuántas entregas se concentren en cada turno, del calendario de pago y de los costes laborales/fiscales aplicables. Los pagos ordinarios por pedidos **no consumen** el tope global de incentivos.

Para cada turno `j`, el backend calcula:

```text
top_up_j = max(0, €28 − remuneración PIKI por entregas de ese turno)
incentivos_mes = Σ top_up_j + €20 × R5 + €30 × R20
```

`R5` es el número de nuevos riders que llega a 5 entregas; `R20` es el número de ellos que completa 20 con referido válido. Si se quiere estimar todo el pago directo a riders, añadir aparte la liquidación ordinaria `€2,50 × entregas + €0,60 × kilómetros` y las demás partidas que correspondan.

## Qué significa un tope global de €10.000 (ejemplo, no recomendación)

Con 4 turnos por rider y 50 referidos completando 20, el techo previo a descontar ganancias de reparto sería €8.100, dejando €1.900 de margen bajo un cap de €10.000. Si todos alcanzaran 20 turnos, la exposición de incentivos de ese escenario podría alcanzar €30.500; un cap de €10.000 **no alcanzaría** para honrar todas esas condiciones. El cap debe derivarse del calendario que se prometa, no usarse como sustituto de una previsión ni comunicarse como una reserva asegurada para cada rider.

## Cómo aplica el backend el límite global

En `src/riderIncentives.ts`:

1. `PIKI_RIDER_INCENTIVES_MONTHLY_CAP_CENTS` se lee como céntimos de euro. El valor inválido, no finito o no positivo se convierte en **€0**. Tanto garantía como referidos requieren su bandera respectiva en `true` y un cap positivo; los referidos requieren además una fecha de campaña válida y ya alcanzada.
2. El periodo se calcula como `YYYY-MM` en UTC. La reserva usa `tenantId: null`, por lo que todos los riders/tenants comparten **un único presupuesto de plataforma por mes**, no 50 límites separados.
3. En una transacción Mongo, el backend crea el documento de presupuesto mensual si hace falta y ejecuta una actualización atómica equivalente a:

   ```text
   filter: monthKey = mes AND committedCents <= capCents − importe
   update: committedCents += importe
   ```

   Si no hay documento que cumpla la condición —por ejemplo, porque el importe superaría el remanente— no crea la entrada de incentivo. Si hay presupuesto, el aumento de `committedCents` y la escritura del ledger con estado `earned` se confirman **en la misma transacción**. Un rollback no deja una reserva suelta ni un bono sin reserva.
4. La pareja de referido consulta las dos claves de idempotencia y reserva **€30 juntos** (o solo el importe faltante si una clave ya existe), luego inserta los movimientos de ambas personas en la misma transacción. Si no cabe el par completo, no divide el bono en dos pagos parciales.
5. `sourceKey` tiene índice único; junto al chequeo previo y hasta tres reintentos acotados ante colisiones de clave, evita duplicar incentivos por llamadas concurrentes o por repetición de eventos. El índice único de presupuesto es `{ tenantId, monthKey }`; `ensureIndexes()` inicializa/sincroniza esos modelos.
6. La pantalla obtiene el comprometido y el disponible como `max(0, cap mensual − committedCents)`. El presupuesto comprometido mide premios devengados en ese mes y los contadores se agrupan por mes UTC.

## Límite del control y precaución de caja

Este cap es un **tope duro de nuevos premios asentados**, no un mecanismo de prefondo de cada turno antes de que el rider lo trabaje. La garantía se comprueba al finalizar el turno; por tanto, un turno podría cumplir los requisitos cuando ya no queda presupuesto y no generar movimiento. El backend tampoco suspende automáticamente la programación de turnos o la campaña al agotarse el cap: el panel puede mostrar €0 disponible mientras los flags siguen activos. Para que el piloto no prometa importes sin cobertura, conviene añadir reserva de hasta €28 al asignar/confirmar cada turno elegible, y cerrar nuevas admisiones/turnos antes de comprometer el remanente.

Asimismo, el ledger deja el bono como `earned`; no lo transfiere a la cuenta del rider. Por eso el impacto calculado es **devengo y necesidad de caja**, no el día exacto del desembolso. La API no se probó contra una base Mongo en esta validación; antes de activar se debe confirmar en staging que Mongo soporta transacciones y verificar la conciliación y el payout.

## Configuración actual y decisión

Las banderas vienen apagadas y el cap de `.env.example` está en 0: el impacto real configurado es **€0 mientras no se active**. Antes de lanzar, definir en Finanzas un cap en céntimos, número/ritmo de turnos, fecha de inicio, política al aproximarse a cero, ciclo de liquidación de riders y un máximo de enrolados. Para una previsión más cerrada hacen falta la distancia media real, pedidos por hora, tasa de turnos elegibles y margen neto por pedido.
