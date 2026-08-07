# CONTEXTO — Proyecto memecoin Solana

> **Léeme entero al inicio de cada sesión.** Este archivo es la fuente única del
> estado del proyecto y de las reglas no negociables. Si algo aquí deja de ser
> cierto, actualízalo en el mismo cambio.
>
> Última actualización: 2026-08-07 (FASES 1-7 completadas; 8 preparada sin ejecutar)

---

## 0. Ubicación y separación de proyectos

**Trabaja SIEMPRE con el cwd en la raíz de este repositorio.**

El operador tiene otros proyectos sin ninguna relación con este en carpetas
hermanas de su equipo. La sesión de arranque se ejecutó por error con el cwd en
uno de ellos (solo lecturas, no se escribió nada), y por eso existe esta
advertencia: **nunca mezclar este proyecto con ningún otro.** Antes de escribir
un fichero, comprueba que la ruta cuelga de este repo.

---

## 1. Objetivo

Crear una **memecoin real en Solana** con el mínimo gasto posible, usando
herramientas open source, y con **transparencia on-chain total**.

Objetivo técnico: que una vez lanzada, *si existe actividad real de mercado*,
sea descubrible automáticamente por DexScreener, Birdeye, AVE.ai, Jupiter y
demás agregadores del ecosistema.

**No** se trata de crear una blockchain propia. Es un token dentro de Solana.

---

## 2. Reglas NO NEGOCIABLES

### 2.1 Prohibido implementar (decisión explícita del operador)

- wash trading · volumen falso · honeypots · bloqueo de ventas
- wallets ocultas del developer · compradores falsos · bots que simulen demanda
- manipulación de holders · market cap artificial · exploits
- mint oculto de tokens nuevos · freeze malicioso · cualquier mecanismo de rug pull

**Toda participación del fundador debe ser visible y verificable on-chain.**
No se divide la asignación entre wallets para disimular concentración.

### 2.2 Seguridad de claves

- **NUNCA** escribir la seed phrase en código, en un archivo del repo, ni pedirla por chat.
- **NUNCA** hardcodear secretos. **NUNCA** subir private keys a git.
- Las claves viven **FUERA del repo**: `<carpeta de usuario>/.solana-memecoin-keys/`
  El `.env` solo guarda la **ruta** al archivo de clave, jamás la clave.
- Los scripts solo imprimen **pubkeys**. Nunca la secret key, ni truncada.
- `.gitignore` ya cubre `.env`, `*.key`, `id*.json`, `keypair*.json`, `/keys/`, `*.seed`, `*.mnemonic`.

### 2.3 Dinero

- **Fase de desarrollo: 0 $.** Todo en devnet / localnet.
- Mainnet: el presupuesto es "lo más barato posible" para el primer lanzamiento.
- **Antes de CUALQUIER operación de mainnet**, obligatorio y en este orden:
  1. Consultar documentación **oficial y actual** (las tarifas de Pump.fun, PumpSwap,
     Raydium, Meteora y Jupiter cambian — **no asumir tarifas antiguas de memoria**).
  2. Calcular el coste exacto estimado en SOL.
  3. Convertir aproximadamente a USD/EUR.
  4. Indicar qué parte es **recuperable** (rent) y cuál **no** (fees).
  5. **NO ejecutar.** Parar y esperar autorización explícita del operador.

### 2.4 Método de trabajo

Cada vez que se ejecute algo, explicar: **QUÉ** se hace · **POR QUÉ** · **CUÁNTO cuesta** ·
**SI usa dinero real** · **SI es reversible**. Si cuesta dinero real → **DETENERSE antes**.

No entregar 2.000 líneas de golpe. Paso a paso.

---

## 3. Entorno verificado (2026-08-07)

| Herramienta | Estado |
| --- | --- |
| Node | ✅ v24.18.0 |
| npm | ✅ 12.0.2 |
| git | ✅ 2.55.0.windows.1 |
| Solana CLI | ❌ no instalado — **y no hace falta** |
| Rust / cargo | ❌ no instalado — **y no hace falta** |
| Anchor | ❌ no instalado — **y no hace falta** |
| pnpm / yarn | ❌ no instalados (usamos npm) |

SO: Windows 11 Pro. Shell: PowerShell (primario) + Git Bash disponible.

### 3.1 Versiones instaladas en FASE 1 (`npm install`, 2026-08-07)

`@solana/web3.js` ^1.98.4 · `@solana/spl-token` ^0.4.15 ·
`@metaplex-foundation/umi` ^1.5.1 · `umi-bundle-defaults` ^1.5.1 ·
`mpl-token-metadata` ^3.4.0 · `dotenv` ^17.4.2 · `zod` ^4.4.3
· dev: `typescript` · `tsx` · `vitest` 4 · `@types/node`

### 3.2 Rarezas del entorno (no son fallos)

- npm 12 bloquea install scripts no aprobados. Por eso `bigint-buffer` imprime
  `Failed to load bindings, pure JS will be used`. **Es inocuo**: usa la
  implementación en JS puro. No hace falta aprobar nada.
- El **faucet público de devnet devuelve 429** ("airdrop limit today or the
  faucet has run dry"). Es un límite por IP del servicio público, no un fallo
  del código. Alternativa: https://faucet.solana.com (se pega ahí la PUBKEY,
  **jamás** la clave privada).

---

## 4. Decisiones de arquitectura ya tomadas

### 4.1 Sin Rust, sin Anchor, sin Solana CLI
No escribimos ningún programa on-chain. Crear un token SPL consiste en **enviar
transacciones a programas ya desplegados** en Solana (SPL Token Program de Solana
Labs; Token Metadata de Metaplex). Todo desde TypeScript. Ahorra ~1,5 GB de
toolchain y elimina la dependencia de compilar nada.

### 4.2 Devnet en vez de `solana-test-validator`
En Windows nativo el validator local requiere WSL, y además **un validator vacío no
tiene desplegado el programa de Metaplex** (habría que clonarlo con `--clone`).
Devnet tiene todos los programas reales, airdrops gratis, y es el mismo código que
mainnet. Estrictamente mejor para nuestro caso. Coste 0 $.
→ Si en el futuro hiciera falta testing determinista/offline, se añade WSL + local validator.

### 4.3 Claves fuera del repo + guard de mainnet
Ver §2.2. Además: **ningún script que gaste dinero se ejecuta sin** (a) variable de
entorno explícita, (b) confirmación interactiva escrita, (c) impresión previa del
coste. Por diseño, no por disciplina del operador.

### 4.4 PENDIENTE de decidir en FASE 6 — SPL clásico vs Token-2022
- **Token-2022**: puede llevar la metadata dentro del propio mint
  (`MetadataPointer` + extensión `TokenMetadata`) → más barato, sin cuenta Metaplex separada.
- **Riesgo**: el soporte en DEXs, agregadores y wallets es más irregular; algunos
  bloquean ciertas extensiones.
- **Inclinación actual**: SPL clásico + metadata Metaplex, por ser la opción
  conservadora para un token cuyo objetivo *es* la descubribilidad.
- El código debe quedar preparado para ambos. **Verificar el estado real del soporte
  con documentación actual antes de decidir.**

### 4.5 Hosting de imagen y metadata — sin servidor
El operador no quiere dominio, web, backend ni base de datos.
Opciones a evaluar (todas 0 $): IPFS vía tier gratuito (Pinata/web3.storage) o
URL raw de GitHub. Decidir en FASE 3/4.

### 4.6 RPC
- Devnet: `https://api.devnet.solana.com` (público, gratis, suficiente).
- Mainnet: tier gratuito de Helius/QuickNode/Triton. Configurable por `.env`.
  Nunca hardcodear la URL.

---

## 5. Stack propuesto (todo open source)

| Pieza | Paquete | Licencia |
| --- | --- | --- |
| SDK base | `@solana/web3.js` v1.x | Apache-2.0 |
| Token SPL | `@solana/spl-token` | Apache-2.0 |
| Metadata | `@metaplex-foundation/umi` + `umi-bundle-defaults` + `mpl-token-metadata` | Apache-2.0 |
| Env | `dotenv` + `zod` (validación) | MIT |
| Ejecutar TS | `tsx` | MIT |
| Tests | `vitest` | MIT |
| Tipos | `typescript`, `@types/node` | Apache-2.0 / MIT |

Nota: se usa **web3.js v1** (no `@solana/kit` v2) porque Umi y la mayoría de SDKs
del ecosistema siguen sobre v1. Revisar si esto cambia.

---

## 6. Estructura de repo prevista

```
solana-memecoin/
├── .env.example               ✅
├── .env                       ✅ (local, ignorado por git — solo rutas)
├── .gitignore                 ✅
├── CONTEXTO.md                ✅ (este archivo)
├── package.json               ✅
├── tsconfig.json              ✅
├── README.md                  ✅
├── config/
│   └── token.config.ts        ✅ supply, decimals, nombre, ticker, asignaciones
├── assets/                    ⬜ vacío (logo.png y metadata.json en FASE 3/4)
├── src/
│   └── lib/
│       ├── env.ts             ✅ carga + valida .env con zod; aborta si ve secretos
│       ├── cluster.ts         ✅ cluster + RPC + verificación de genesis hash
│       ├── wallet.ts          ✅ carga SEGURA de keypair (nunca loguea secretos)
│       ├── guard.ts           ✅ gate de seguridad para mainnet
│       ├── cost.ts            ✅ rent y fees consultados al RPC, sin hardcode
│       └── log.ts             ✅ incluye el bloque QUÉ/POR QUÉ/CUÁNTO/…
├── scripts/
│   ├── wallet-new.ts          ✅ genera keypair FUERA del repo, no sobrescribe
│   ├── wallet-show.ts         ✅ imprime solo pubkey
│   ├── balance.ts             ✅
│   ├── airdrop.ts             ✅ devnet únicamente (bloqueado en mainnet)
│   ├── estimate-cost.ts       ✅ solo lectura, gratis
│   ├── preflight.ts           ✅ TODAS las comprobaciones; ABORTA si algo es peligroso
│   ├── token-create.ts        ⬜ FASE 3
│   ├── metadata-attach.ts     ⬜ FASE 3
│   ├── verify-supply.ts       ⬜ FASE 4
│   ├── verify-authorities.ts  ⬜ FASE 4
│   ├── verify-metadata.ts     ⬜ FASE 4
│   └── inspect-distribution.ts ⬜ FASE 4
└── tests/
    └── safety.test.ts         ✅ 10 tests de invariantes de seguridad
```

`npm run preflight` debe abortar ante cualquier configuración peligrosa o inconsistente.

---

## 7. Temas ABIERTOS que hay que analizar (no implementar aún)

### 7.1 Asignación del fundador — analizar 3% / 5% / 10%
Escenario de partida a estudiar: supply 1.000.000.000, fundador ~10% (100.000.000).
**NO implementar ese 10% todavía.** Primero analizar si genera desconfianza en traders
y en sistemas de análisis automático (RugCheck, Bubblemaps, pestaña de holders de
DexScreener, Birdeye). Comparar las tres opciones con criterios verificables.
La asignación debe ser **pública y fácil de identificar**, en una sola wallet.

### 7.2 Vesting / lock opcional
Estudiar si mejora la credibilidad. Evaluar opciones open source y gratuitas
(p. ej. Jupiter Lock, Streamflow). Verificar coste real y si el lock es
públicamente verificable por terceros.

### 7.3 Autoridades — analizar antes de tocar
Analizar específicamente `mintAuthority`, `freezeAuthority`, `updateAuthority`:
qué revocar, **cuándo**, y qué consecuencias **irreversibles** tiene cada revocación.
**No revocar nada** hasta confirmar que metadata, supply y configuración son definitivos.
(Revocar es irreversible: no hay vuelta atrás.)

> **§7.1 y §7.4: analizados.** Ver `docs/ANALISIS-7.1-asignacion-fundador.md` y
> `docs/FASE6-mecanismos.md`. Las *decisiones* siguen abiertas: el análisis está
> hecho, elegir es del operador. §7.2 sigue **sin analizar**.

### 7.4 Comparativa de mecanismos de lanzamiento (FASE 6)
Comparar, con documentación **actual**, como mínimo:
- **Pump.fun / PumpSwap**
- **SPL Token + creación de liquidez en un DEX** (Raydium / Meteora / Orca)

Ejes de comparación: coste · liquidez necesaria · distribución · descubrimiento ·
creator fees · control del token · metadata · facilidad para traders · integración
con agregadores · riesgos · aparición en AVE.ai / Birdeye / DexScreener · Jupiter.

**Distinguir siempre entre:** (1) indexación/detección automática, (2) verificación,
(3) promoción de pago. **No queremos pagar promoción.** No asumir que hay que pagar
a los trackers para aparecer.

### 7.5 Creator fees
Si el mecanismo elegido ofrece creator fees legítimas, analizarlas: ¿puede el creador
recibir SOL por volumen **real** sin vender continuamente su asignación?
**Nunca simular volumen para generar estas fees.**

---

## 8. FASES — estado actual

| Fase | Descripción | Estado |
| --- | --- | --- |
| **1** | Preparar entorno y repositorio | ✅ **COMPLETADA** |
| **2** | Construir versión local/devnet | ✅ **COMPLETADA** |
| **3** | Crear token de prueba (devnet) | 🟠 **CÓDIGO LISTO Y SIMULADO — bloqueado por el faucet** |
| **4** | Probar metadata, supply, authorities, distribución | ✅ **COMPLETADA** (verificada contra un token real de mainnet) |
| **5** | Simular lanzamiento completo sin dinero real | ✅ **COMPLETADA** |
| **6** | Comparar mecanismos actuales de lanzamiento | ✅ **COMPLETADA** → `docs/FASE6-mecanismos.md` |
| **7** | Presentar presupuesto exacto de mainnet | ✅ **COMPLETADA** → `npm run budget:mainnet` |
| **8** | **Solo con autorización**, preparar lanzamiento real | 🟠 **PREPARADA, NO EJECUTADA** → `docs/FASE8-runbook-mainnet.md` |

Todo a fecha de **2026-08-07**. **Gasto real acumulado: 0 €.**

### Por qué la FASE 3 no está cerrada

El faucet público de devnet lleva todo el día devolviendo **429** ("airdrop limit
today or the faucet has run dry") desde todos los RPC probados
(`api.devnet.solana.com`, Alchemy demo, Ankr). La wallet sigue a **0 SOL**, y sin
saldo no se puede crear el mint.

**No es un fallo del código.** Lo construido está verificado por otras vías:

- `npm run simulate:launch` recorre el flujo completo y diagnostica correctamente.
- `tests/instructions.test.ts` comprueba **byte a byte** las instrucciones reales.
- La FASE 4 se validó contra un token real de mainnet (BONK), en solo lectura.

**Para desbloquearla:** consigue SOL de prueba en https://faucet.solana.com
(pega ahí la PUBKEY, **nunca** la clave privada), y luego:
`npm run token:create` · `npm run metadata:attach` · `npm run verify:all`.

### FASE 8 — qué significa "preparada, no ejecutada"

El runbook está escrito y los cerrojos implementados y probados. **No se ha
ejecutado ni un solo paso**, porque §2.3 exige autorización explícita y no se ha
dado. Ver `docs/FASE8-runbook-mainnet.md` §0 para la lista de cerrojos activos.

### Hecho en FASE 1 — COMPLETA

- ✅ Entorno inspeccionado (§3) · arquitectura decidida (§4)
- ✅ Repo + `git init` + carpetas + `.gitignore` + este `CONTEXTO.md`
- ✅ `package.json`, `tsconfig.json` (strict), `.env.example`, `README.md`
- ✅ `config/token.config.ts` — tokenómica como **datos**, validada con zod.
  Las decisiones de §4.4, §7.1 y §7.3 quedan explícitamente **sin tomar**.
  `validateTokenConfig(true)` las convierte en errores bloqueantes para FASE 3.
- ✅ `src/lib/`: `env.ts`, `cluster.ts`, `wallet.ts`, `guard.ts`, `cost.ts`, `log.ts`
- ✅ `scripts/`: `wallet-new.ts`, `wallet-show.ts`, `balance.ts`, `airdrop.ts`,
  `estimate-cost.ts`, `preflight.ts` — **todos de solo lectura o locales**
- ✅ `tests/safety.test.ts` — 10 tests, verdes
- ✅ `npm install` · `tsc --noEmit` limpio
- ✅ Wallet de devnet generada FUERA del repo:
  pubkey `Dxk5vVZfkLRYVQ1G1tjJoJyChP2nb3WED59HpuZmq9ar`
  fichero `<carpeta de usuario>/.solana-memecoin-keys/devnet.json` (fuera del repo)
- ✅ `npm run preflight` → **12 correctas · 2 avisos · 0 errores · 0 € gastados**
- ⚠ **Airdrop de devnet PENDIENTE**: el faucet público devuelve 429 (§3.2).
  La wallet está a 0 SOL. Hay que conseguir SOL de prueba antes de la FASE 3.

### Guardas de seguridad implementadas y **verificadas con pruebas negativas**

Se comprobó que cada guarda efectivamente **aborta** (no solo que pasa en verde):

| Escenario provocado | Resultado |
| --- | --- |
| Script que hace `console.log(kp.secretKey)` | `preflight` lo detecta y falla |
| `CLUSTER=mainnet-beta` | `preflight` falla; `airdrop` bloqueado por código |
| `CLUSTER=devnet` pero `RPC_URL` de mainnet | abortado por **genesis hash** |
| `KEYPAIR_PATH` dentro del repo | rechazado antes de leer nada |
| Material de clave dentro de `.env` | `env.ts` aborta el proceso al cargar |

Además: `guard.ts` exige, para gastar en mainnet, **las dos** variables de
entorno + frase exacta tecleada en un TTY + desglose de coste impreso antes.
`cost.ts` **no hardcodea tarifas**: rent, fee base y fee de prioridad se
preguntan al RPC en vivo. La conversión a fiat solo aparece si el operador
rellena `SOL_PRICE_USD` / `EUR_PER_USD` a mano.

### Coste medido en devnet (2026-08-07, RPC en vivo)

Crear el token: mint (82 B) + ATA (165 B) + metadata Metaplex (679 B) + 3 tx
→ **≈ 0,00913 SOL**, de los cuales ≈ 0,0035 SOL son rent recuperable.
El rent se calcula igual en mainnet; las fees de prioridad sí varían.
**No incluye** comisiones de Pump.fun/Raydium/Meteora/Orca/Jupiter ni capital
de liquidez: se consultarán en documentación oficial y actual en FASE 6-7.

### Hecho en las FASES 2-7

- ✅ **Perfiles** en `config/token.config.ts`: `devnet` cerrado, `mainnet`
  bloqueado. `assertProfileReadyForLaunch('mainnet')` lanza mientras §4.4, §7.1
  y §7.3 sigan abiertas, y hay tests que verifican que **siguen** abiertas.
- ✅ `src/lib/tx.ts` — toda transacción pasa por: **simular → dry-run → enviar**.
  Nunca se firma sin simular antes.
- ✅ `src/lib/token-build.ts` — construcción de instrucciones, separada para
  poder testearla **byte a byte** sin red ni fondos.
- ✅ `src/lib/inspect.ts` — decodifica la metadata Metaplex **a mano**, sin el
  SDK, para que el verificador no herede los fallos de la librería con la que
  se escribió.
- ✅ `src/lib/verify.ts` + 5 scripts de verificación.
- ✅ `src/lib/args.ts` — npm 12 rechaza los flags desconocidos (`EUNKNOWNCONFIG`);
  las opciones se aceptan como `dry-run`, `--dry-run` o `DRY_RUN=1`.
- ✅ `scripts/authorities-revoke.ts` — el paso irreversible, aislado, con su
  propia confirmación (`REVOCAR PARA SIEMPRE`) y comprobaciones de sensatez
  (no revoca mintAuthority si el supply es 0 o si falta la metadata).
- ✅ **34 tests** en verde · `tsc --noEmit` limpio.
- ✅ Documentos: `docs/FASE6-mecanismos.md`,
  `docs/ANALISIS-7.1-asignacion-fundador.md`, `docs/FASE8-runbook-mainnet.md`.

### Coste medido (RPC en vivo, 2026-08-07)

Crear el token: **≈ 0,00913 SOL** (mint 82 B + ATA 165 B + metadata 679 B + 3 tx),
de los cuales ≈ 0,0035 SOL es rent recuperable. Idéntico en mainnet salvo fees de
prioridad. `npm run budget:mainnet` lo recalcula y **exige** que le pases a mano
el coste del pool y el capital de liquidez, porque esas cifras no se pueden saber
de memoria (ver `docs/FASE6-mecanismos.md`).

### Decisiones que siguen siendo TUYAS (bloquean mainnet)

| Tema | Estado | Dónde está el análisis |
| --- | --- | --- |
| §7.1 asignación del fundador | 🔒 abierta | `docs/ANALISIS-7.1-asignacion-fundador.md` — **recomendación: 5 %** |
| §4.4 SPL clásico vs Token-2022 | 🔒 abierta | el código soporta ambos; inclinación conservadora: SPL clásico |
| §7.3 revocación de autoridades | 🔒 abierta | `docs/FASE8-runbook-mainnet.md` |
| §7.2 vesting / lock | ⬜ **sin analizar** | pendiente: condiciona §7.1 |
| Capital de liquidez | ⬜ **sin cifra** | `docs/FASE6-mecanismos.md` §3 — condiciona todo |

### Siguiente paso inmediato

1. Conseguir SOL de devnet en https://faucet.solana.com y cerrar la FASE 3.
2. Analizar §7.2 (vesting/lock gratuito y verificable por terceros).
3. Decidir §7.1 y §4.4.
4. Fijar el capital de liquidez: sin esa cifra no se puede cerrar la FASE 6.

---

## 9. Aviso registrado (para que no se re-litigue)

En la conversación de arranque se le explicó al operador que: (a) ningún token nuevo
tiene crecimiento garantizado, (b) el market cap no equivale a dinero extraíble por
el efecto de slippage en la curva, y (c) el dinero que salga procede necesariamente
de otros compradores. El operador lo entendió y decidió continuar, excluyendo
explícitamente todos los mecanismos manipulativos (§2.1).

**Decisión tomada. No repetir el aviso en cada sesión.** Mantener sí el rigor técnico:
costes reales, sin promesas de rentabilidad, y parada obligatoria antes de gastar.
