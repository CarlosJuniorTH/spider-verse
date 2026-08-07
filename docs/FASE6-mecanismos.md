# FASE 6 — Comparativa de mecanismos de lanzamiento

> Consultado el **7 de agosto de 2026**. Fuentes oficiales enlazadas al final.
>
> ⚠ **Este documento caduca.** Las tarifas de Pump.fun, Raydium y Meteora cambian
> con frecuencia. Antes de cualquier operación de mainnet hay que **volver a
> consultar** (CONTEXTO.md §2.3). No copies estas cifras a un presupuesto sin
> revalidarlas.

---

## 0. Lo primero: qué NO hay que pagar

CONTEXTO.md §7.4 pide distinguir tres cosas que suelen confundirse. Verificado:

| Concepto | ¿Se paga? | Qué dice la fuente oficial |
| --- | --- | --- |
| **Indexación automática** en DexScreener | **NO** | "All tokens are listed on DEX Screener automatically as soon as they are added to a liquidity pool and have at least one transaction." |
| **Routing automático** en Jupiter | **NO** | Jupiter documenta que no hay pago para listar; la cualificación es automática en los DEX soportados |
| **Enhanced Token Info** (DexScreener) | **SÍ** | Producto de pago. Acelera/controla la ficha. **No es necesario para aparecer.** |

**Conclusión operativa:** para ser descubrible NO hay que pagar a ningún tracker.
Basta con crear el pool y que haya **una transacción real**. Cualquiera que te
diga que hay que pagar para "aparecer" en DexScreener o Jupiter está vendiendo
algo distinto (promoción), y §7.4 dice explícitamente que no queremos pagar promoción.

### Criterio real de Jupiter para enrutar (verificado en docs oficiales)

Un mercado debe cumplir **al menos uno**:

1. **Test de ida y vuelta**: con 500 $ de referencia, comprar y vender de vuelta
   debe dar menos de **30 %** de diferencia de precio.
2. **Comparación de impacto**: comparando una compra de 1.000 $ contra una de
   500 $, la diferencia de impacto no debe superar el **20 %**.

Detalles: se recomprueba **cada 30 minutos**; los tokens nuevos tienen un
**periodo de gracia de ~30 días** (basado en la edad del *token*, no del mercado)
durante el cual no se aplican esos criterios. Si un mercado deja de cumplirlos,
sale del enrutado y Jupiter devuelve `NO_ROUTES_FOUND`.

> **Lectura importante:** eso significa que la liquidez tiene que ser *suficiente
> de verdad*. Un pool con 50 $ dentro no pasa el test de los 500 $ y acaba fuera
> del enrutado cuando termine la gracia. No es un trámite: es un requisito
> económico real.

---

## 1. Los dos caminos

### Opción A — Plataforma de lanzamiento con bonding curve (Pump.fun / PumpSwap)

**Cómo funciona.** No creas un pool. Creas un token sobre una *curva de precio*
donde el precio sube según se compra. Cuando la curva se completa, el token
"gradúa" y migra automáticamente a un AMM (PumpSwap) con la liquidez acumulada.

| Eje | Valoración |
| --- | --- |
| Coste inicial | **Muy bajo.** No aportas liquidez propia. |
| Liquidez necesaria | **Ninguna por tu parte.** La aportan los compradores. |
| Distribución | Orgánica: quien compra, tiene. |
| Descubrimiento | **Excelente.** La propia plataforma es un escaparate con tráfico. |
| Creator fees | **Sí**, es su rasgo diferencial (ver §2). |
| Control del token | **Bajo.** La plataforma fija supply, decimales y curva. |
| Metadata | La gestiona la plataforma. |
| Riesgo | Depender de un tercero. Y **ratio de graduación muy bajo** (ver §2.1 abajo). |

#### 2.1 Tasa de graduación — cifras verificadas (agosto 2026)

Esto es lo que decide si "crear por 2-3 $" significa algo:

| Periodo | Tasa de graduación |
| --- | --- |
| Histórico | **por debajo del 2 %** |
| Junio 2026 | **0,26 %** — unos 2-3 de cada 1.000 |
| Tras el mecanismo BOOST | **~6,7 %** |

La curva se completa cuando acumula **~85 SOL de compras reales**. Ese dinero lo
ponen terceros comprando; no lo aporta el creador.

**Lectura correcta:** el coste de entrada es bajísimo, y por eso mismo la
competencia es masiva y la tasa de éxito es la que es. Lo barato es crear el
token; lo difícil es que 85 SOL de desconocidos entren en tu curva. Fabricar esa
actividad está prohibido por §2.1 y no se va a implementar.

### Opción B — Token SPL propio + pool en un DEX (Raydium / Meteora / Orca)

**Cómo funciona.** Es lo que ya tiene construido este repositorio: creas el mint,
acuñas el supply, adjuntas metadata, y luego creas un pool aportando **tu propia
liquidez** (tokens + SOL).

| Eje | Valoración |
| --- | --- |
| Coste inicial | Bajo en comisiones, **pero requiere capital de liquidez**. |
| Liquidez necesaria | **La pones tú.** Es el gran condicionante. |
| Distribución | La decides tú (§7.1), y queda pública. |
| Descubrimiento | Igual de automático, en cuanto hay pool + 1 transacción. |
| Creator fees | Solo la parte de comisión de trading que corresponde al LP. |
| Control del token | **Total.** Supply, decimales, autoridades, metadata. |
| Metadata | Tuya (ya implementado: `metadata:build` + `metadata:attach`). |
| Riesgo | Nadie te trae compradores. Empiezas de cero. |

---

## 2. Costes verificados, y lo que NO he podido verificar

### Raydium — CPMM (fuente oficial)

- **Coste de crear el pool: ~0,2 SOL**, que la documentación describe como
  "pool creation rent, token-account creation, and priority fees".
- **Tramos de comisión de trading**: **0,01 % · 0,25 % · 1 %**.
  El 0,25 % es el recomendado por defecto para pares volátiles.
- **CPMM no necesita market ID de OpenBook** (a diferencia del antiguo AMM v4).
  Esto es relevante: el AMM v4 obligaba a crear un mercado OpenBook, que era la
  partida cara del lanzamiento clásico. **Ese coste ya no aplica** si usas CPMM.

> ⚠ La página que pude leer da la cifra agregada (~0,2 SOL) sin desglosarla.
> Un resultado de búsqueda secundario mencionaba "0,15 SOL de protocol fee",
> pero **no lo pude confirmar en la página oficial**, así que no lo doy por bueno.

### Meteora — DBC (Dynamic Bonding Curve)

- La comisión de creación de pool es **configurable por el partner**
  (`poolCreationFee`, en lamports), no es un número fijo del protocolo.
- Se menciona **0,01 SOL** para pools Token-2022 en modo de cobro "Output Token".
- Meteora se queda el **10 %** de las comisiones de creación recaudadas.

> ⚠ Al ser configurable, **no existe "la tarifa de Meteora"**. Depende del config
> key que uses. Hay que mirarlo en el momento, para la config concreta.

### Pump.fun — aquí hay que ser honesto

Lo que **sí** está en documentación oficial:

- Cada operación reparte la comisión en tres: **Protocol fee** (plataforma),
  **Creator fee** (creador) y **LP fee** (vuelve al pool).
- Las comisiones son **escalonadas según capitalización de mercado**, calculadas
  por tramos.
- Las comisiones dinámicas pasaron a ser obligatorias el **1 de septiembre, 20:00 UTC**.
- Los creadores cobran creator fee para monedas presentes en la curva o en
  PumpSwap **desde el 13 de mayo de 2025**.
- Desde el **21 de mayo de 2026** se puede emparejar con **USDC** además de SOL.
- Solo los "canonical pools" (los creados por la instrucción `migrate` al
  completarse la curva) generan creator fee.

Lo que **NO** he podido verificar en fuente oficial:

| Dato | Estado |
| --- | --- |
| Comisión exacta de creación (se cita ~0,02 SOL) | ❌ **solo en fuentes secundarias** |
| Los porcentajes numéricos de cada tramo | ❌ **la doc oficial los publica como IMAGEN**, no como texto |
| Umbral exacto de graduación (se cita ~69.000 $) | ❌ **no confirmado en doc oficial** |
| Precio de Enhanced Token Info de DexScreener | ❌ no está en su documentación |

**Esto no es un descuido: es el hallazgo.** El esquema de comisiones de Pump.fun
es escalonado, cambiante y publicado en una imagen. Cualquier cifra concreta que
alguien te dé "de memoria" está mal por definición. Por eso el presupuesto de la
FASE 7 **exige introducir estas cifras a mano** tras consultarlas, y el código no
las hardcodea en ningún sitio.

---

## 3. Recomendación

**Para este proyecto, la Opción B (token SPL propio + CPMM de Raydium).**

Motivos, en orden de peso:

1. **§2.1 lo exige de facto.** La transparencia total y la asignación del fundador
   "visible y verificable en una sola wallet" requieren controlar el supply y las
   autoridades. En una plataforma de lanzamiento no controlas eso.
2. **§7.3 no es posible en la Opción A.** No puedes decidir tú qué autoridades
   revocar ni cuándo si el token lo emite la plataforma.
3. **El coste en comisiones es bajo y conocido** (~0,2 SOL de pool + ~0,01 SOL
   del token, ya medido en devnet). Lo caro es la liquidez, y eso es capital
   **tuyo que sigue siendo tuyo** dentro del pool, no una comisión perdida.
4. **CPMM eliminó el coste del market ID de OpenBook**, que era la razón histórica
   por la que "lanzar en Raydium" salía caro. Ese argumento ya no vale.
5. La descubribilidad es **idéntica** por los dos caminos: ni Jupiter ni
   DexScreener cobran ni discriminan por origen.

**El contraargumento honesto a favor de la Opción A:** no necesitas poner capital,
y la plataforma te da tráfico. Si el presupuesto para liquidez es cercano a cero,
la Opción B produce un pool que **no pasará el test de los 500 $ de Jupiter** y el
token quedará fuera del enrutado al acabar el periodo de gracia. En ese escenario
la Opción B es peor, no mejor.

> **La pregunta que decide** no es técnica: **¿cuánto capital de liquidez puedes
> poner?** Sin esa cifra no se puede cerrar la FASE 6. Con ella, la decisión es
> mecánica.

---

## 4. Sobre las creator fees (§7.5)

Pump.fun sí permite al creador cobrar por volumen real, y está documentado. La
regla del proyecto se mantiene intacta: **nunca simular volumen para generar esas
comisiones** (§2.1). Cobrar por actividad real de terceros es legítimo; fabricar
esa actividad es exactamente lo que este proyecto excluyó.

En la Opción B, el equivalente es la parte LP de la comisión de trading: si
aportas liquidez, te corresponde una fracción de las comisiones que pagan quienes
operan contra tu pool. También es legítimo y también depende de volumen real.

---

## 5. Fuentes

- [Jupiter — Market Listing (routing)](https://developers.jup.ag/docs/routing/market-listing)
- [DEX Screener — Token Listing](https://docs.dexscreener.com/token-listing)
- [Raydium — Create a CPMM pool](https://docs.raydium.io/user-flows/create-cpmm-pool)
- [Pump.fun — Fees](https://pump.fun/docs/fees)
- [Pump.fun — Bonding curve](https://pump.fun/docs/bonding-curve)
- [pump-fun/pump-public-docs — FEE_PROGRAM_README](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_PROGRAM_README.md)
- [pump-fun/pump-public-docs — PUMP_SWAP_CREATOR_FEE_README](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_CREATOR_FEE_README.md)
- [Meteora — DBC](https://docs.meteora.ag/overview/products/dbc/what-is-dbc)
- [Meteora — DAMM v2](https://docs.meteora.ag/overview/products/damm-v2/what-is-damm-v2)
