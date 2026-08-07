# §7.2 — Vesting / lock de la asignación del fundador

> Consultado el **7 de agosto de 2026** en documentación oficial.
> Este análisis **desbloquea §7.1**: la existencia de un lock gratuito y
> verificable cambia qué porcentaje es defendible.

---

## 1. La pregunta

CONTEXTO.md §7.2 pedía verificar si existe una opción de bloqueo que sea:

1. **gratuita**,
2. **públicamente verificable por terceros**.

Respuesta: **sí, las dos cosas.**

---

## 2. Opciones verificadas

| | **Jupiter Lock** | **Streamflow** |
| --- | --- | --- |
| Coste de protocolo | **Ninguno** — solo fees de red de Solana | **0,117 SOL** por lock/vesting |
| Open source | Sí, en GitHub | Parcial |
| Auditorías | OtterSec y Sec3, informes públicos | — |
| Verificable por terceros | Sí: escrow on-chain con condiciones transparentes | Sí |
| Cliff + vesting lineal | Sí, aplicado on-chain | Sí, más tipos de desbloqueo |

Cita literal de la documentación de Jupiter:
*"Jupiter Lock has no protocol fees. Only standard Solana network fees apply."*

**Recomendación: Jupiter Lock.** Cubre lo que necesitamos a coste 0 y está
auditado. Streamflow tiene más funciones (auto-claim, desbloqueo por precio),
pero ninguna hace falta aquí y cuesta dinero.

---

## 3. ⚠ El detalle que lo decide todo

La documentación de Jupiter dice que **el creador del lock elige quién puede
cancelarlo**: *"the lock creator decides who can cancel the lock and who can
change the recipient (creator, recipient, both, or none)."*

**Un lock que tú puedes cancelar no vale absolutamente nada para la
credibilidad.** Si puedes deshacerlo, no has bloqueado nada: has puesto un
cartel. Y cualquiera que sepa leer la cuenta on-chain lo verá.

Por tanto, si se usa lock, la configuración obligatoria es:

- **cancelar: nadie (`none`)**
- **cambiar destinatario: nadie (`none`)**

Sin esas dos condiciones, el lock es decorativo y es peor que no tenerlo,
porque parece una garantía y no lo es.

---

## 4. Consecuencia sobre §7.1

El [análisis de §7.1](ANALISIS-7.1-asignacion-fundador.md) concluía:

> El 10 % solo tiene sentido **si va acompañado de lock verificable**. Sin lock,
> el coste reputacional supera al beneficio.

Esa condición **ahora se puede cumplir a coste cero**. Con lock no cancelable:

| | Sin lock | Con lock no cancelable |
| --- | --- | --- |
| **3 %** | defendible | innecesario, ya era defendible |
| **5 %** | defendible | sólido |
| **10 %** | **bandera roja** | **defendible** |

**Un 10 % bloqueado es más creíble que un 5 % líquido**, porque la credibilidad
no la da el número sino la imposibilidad de hacer daño. Un 5 % suelto puede
venderse entero mañana; un 10 % con cliff no.

---

## 5. Lo que hay que decidir además del porcentaje

Elegir "10 % con lock" no cierra el tema. Faltan tres parámetros, y son
irreversibles una vez creado el lock:

1. **Cliff** — cuánto tiempo sin desbloquear nada. Es la parte que de verdad
   tranquiliza. Un cliff corto (días) no convence a nadie.
2. **Duración del vesting** — en cuánto tiempo se libera el resto, linealmente.
3. **Qué porcentaje se bloquea** — puede ser todo tu 10 %, o una parte.

Un esquema habitual y defendible: **cliff de varios meses + liberación lineal
durante 1-2 años**. Pero esto es una decisión de negocio tuya, no técnica, y
tiene una contrapartida real: **tú tampoco podrás tocar esos tokens.** Si
necesitas liquidez antes de que venza, no la vas a tener. No hay excepción.

---

## 6. Estado

- §7.2: **ANALIZADO.** Existe opción gratuita y verificable (Jupiter Lock).
- La *decisión* de usarlo, con qué porcentaje y con qué calendario, sigue siendo
  del operador.
- **No implementado.** Jupiter Lock se usa desde su interfaz web, no desde este
  repositorio. Se haría después de crear el token y antes de dar liquidez.

---

## 7. Fuentes

- [Jupiter Lock — documentación oficial](https://docs.jup.ag/user-docs/launch/lock)
- [Streamflow — costes de uso](https://docs.streamflow.finance/en/articles/9675153-costs-of-using-streamflow)
