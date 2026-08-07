# solana-memecoin

Memecoin en Solana con **transparencia on-chain total**.
Todo el desarrollo ocurre en **devnet**, con **coste 0 €**.

> El estado del proyecto, las decisiones de arquitectura y las reglas no
> negociables están en **[`CONTEXTO.md`](CONTEXTO.md)**. Ese fichero manda sobre
> este. Léelo antes de tocar nada.

---

## Qué es y qué no es

- **Sí es**: un token SPL dentro de la red Solana, creado enviando transacciones
  a programas ya desplegados (SPL Token de Solana Labs, Token Metadata de Metaplex).
- **No es**: una blockchain propia. No hay ningún programa on-chain escrito por
  nosotros, así que no hacen falta Rust, Anchor ni la Solana CLI.

## Lo que este proyecto NO va a implementar

Decisión explícita del operador ([`CONTEXTO.md` §2.1](CONTEXTO.md)):
wash trading, volumen falso, honeypots, bloqueo de ventas, wallets ocultas del
desarrollador, compradores falsos, bots que simulen demanda, manipulación de
holders, market cap artificial, exploits, mint oculto, freeze malicioso, ni
ningún mecanismo de rug pull.

Toda participación del fundador será **visible y verificable on-chain**, en una
sola wallet, sin trocearla para disimular concentración.

---

## Requisitos

| Herramienta | Versión verificada |
| --- | --- |
| Node.js | v24.18.0 (mínimo 20) |
| npm | 12.0.2 |
| git | 2.55.0 |

No hacen falta Rust, Anchor ni Solana CLI.

---

## Instalación

```bash
npm install
```

Copia la plantilla de entorno (en PowerShell):

```bash
copy .env.example .env
```

El `.env` **solo guarda la ruta** al fichero de clave. Jamás una clave.

---

## Seguridad de claves — léelo entero

- Las claves viven **fuera del repositorio**, en `<carpeta de usuario>/.solana-memecoin-keys/`.
- El código **se niega** a leer o escribir una clave que esté dentro del repo.
- Los scripts imprimen **solo pubkeys**. La clave privada no se muestra nunca,
  ni entera ni truncada.
- **No se generan ni se piden seed phrases en ningún punto del proyecto.** Un
  keypair de Solana es un par ed25519 y no necesita mnemónico para nada de lo
  que hacemos aquí. Si alguna herramienta te pide una seed phrase, desconfía.
- `src/lib/env.ts` **aborta el proceso** si detecta material de clave dentro del
  `.env` (nombres de variable sospechosos, arrays de 64 bytes o 12/24 palabras).
- `npm run preflight` comprueba que git no siga ningún fichero sensible.

**Aviso sobre Windows**: `chmod 600` es prácticamente simbólico en NTFS. El
fichero de clave está protegido de facto por los permisos de tu usuario de
Windows. No lo copies al repo, no lo sincronices con OneDrive/Dropbox y no lo
pegues en ningún chat.

---

## Comandos

| Comando | Qué hace | Coste | Dinero real |
| --- | --- | --- | --- |
| **Entorno** | | | |
| `npm run wallet:new` | Genera un keypair fuera del repo. No sobrescribe uno existente. | 0 € | No |
| `npm run wallet:show` | Imprime solo la pubkey. | 0 € | No |
| `npm run balance` | Lee el saldo en el RPC. | 0 € | No |
| `npm run airdrop` | SOL de **prueba** de devnet. Bloqueado en mainnet por código. | 0 € | No |
| `npm run preflight` | Auditoría completa. Sale con código 1 si algo es peligroso. | 0 € | No |
| **Crear el token** | | | |
| `npm run metadata:build` | Genera `assets/metadata.json`. No sube nada a ningún sitio. | 0 € | No |
| `npm run token:create` | Crea el mint, las cuentas y acuña el supply. | rent + fees | Solo en mainnet |
| `npm run metadata:attach` | Adjunta la metadata Metaplex on-chain. | rent + fee | Solo en mainnet |
| `npm run authorities:revoke` | **IRREVERSIBLE.** Revoca autoridades. | 1 fee | Solo en mainnet |
| **Verificar** (solo lectura) | | | |
| `npm run verify:supply` | Supply, decimales, y si el supply es fijo. | 0 € | No |
| `npm run verify:authorities` | Estado real de mint/freeze/updateAuthority. | 0 € | No |
| `npm run verify:metadata` | Metadata on-chain + descarga la URI + comprueba la imagen. | 0 € | No |
| `npm run inspect:distribution` | Mayores tenedores y concentración. | 0 € | No |
| `npm run verify:all` | Informe público completo. | 0 € | No |
| **Coste** | | | |
| `npm run estimate-cost` | Estima rent + fees preguntando al RPC en vivo. | 0 € | No |
| `npm run simulate:launch` | Simula el lanzamiento entero sin firmar nada. | 0 € | No |
| `npm run budget:mainnet` | Presupuesto de mainnet. No puede gastar. | 0 € | No |
| **Calidad** | | | |
| `npm run typecheck` · `npm test` | `tsc --noEmit` · vitest | 0 € | No |

### Cómo pasar opciones

npm 12 **rechaza los flags que no conoce**, así que `-- --dry-run` falla con
`EUNKNOWNCONFIG`. Las opciones se aceptan de tres formas equivalentes:

```bash
npm run token:create -- dry-run
```

```bash
npx tsx scripts/token-create.ts --dry-run
```

```bash
DRY_RUN=1 npm run token:create
```

Con valor, igual: `npm run budget:mainnet -- pool-sol=0.2 liquidity-sol=5`.

Los verificadores aceptan cualquier mint, también de otros proyectos:

```bash
npm run verify:all -- DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

### Flujo de la primera vez

```bash
npm install
```

```bash
npm run wallet:new
```

```bash
npm run airdrop
```

```bash
npm run preflight
```

Luego, en devnet:

```bash
npm run simulate:launch
```

```bash
npm run token:create
```

```bash
npm run metadata:build
```

```bash
npm run verify:all
```

---

## Cómo se controla el gasto

Está impuesto **por diseño**, no por disciplina ([`CONTEXTO.md` §4.3](CONTEXTO.md)):

1. `src/lib/guard.ts` es la única vía para ejecutar algo que gaste. En mainnet
   exige **las dos** variables de `.env` (`ALLOW_MAINNET` y
   `I_UNDERSTAND_THIS_SPENDS_REAL_MONEY`), imprime el desglose de coste y pide
   teclear una frase exacta en un terminal interactivo. Si falta cualquiera de
   las tres cosas, no se ejecuta nada.
2. `src/lib/cluster.ts` compara el **genesis hash** que devuelve el RPC con la
   red que dice el `.env`. Un `RPC_URL` mal puesto no puede hacerte operar en
   mainnet creyendo que estás en devnet.
3. `scripts/airdrop.ts` está bloqueado en mainnet a nivel de código.
4. `npm run preflight` falla si `CLUSTER=mainnet-beta` o si alguna guarda está
   desactivada.

### Sobre las cifras de coste

`src/lib/cost.ts` **no hardcodea tarifas**: el rent se calcula con
`getMinimumBalanceForRentExemption`, la fee con `getFeeForMessage` sobre un
mensaje real y la fee de prioridad con `getRecentPrioritizationFees`. Todo en
vivo contra el RPC.

Lo que **no** cubre y se consultará en documentación oficial y actual en las
FASES 6-7: comisiones de Pump.fun, PumpSwap, Raydium, Meteora, Orca y Jupiter,
y el capital de liquidez inicial. Esas cifras **no se dan de memoria**.

La conversión a USD/EUR solo aparece si rellenas `SOL_PRICE_USD` y `EUR_PER_USD`
en el `.env` con la cotización que consultes tú. El proyecto no inventa precios.

---

## Estructura

```
config/token.config.ts   Tokenómica como datos, en DOS PERFILES + validación zod
src/lib/env.ts           Carga y valida .env; aborta si detecta secretos
src/lib/cluster.ts       Red, RPC y verificación de genesis hash
src/lib/wallet.ts        Carga/creación segura de keypairs
src/lib/guard.ts         Puerta de seguridad para gastar
src/lib/cost.ts          Estimación de rent y fees (siempre vía RPC)
src/lib/tx.ts            Simular → dry-run → enviar. Toda tx pasa por aquí.
src/lib/token-build.ts   Construcción de instrucciones (testeada byte a byte)
src/lib/inspect.ts       Lectura del estado real de la cadena
src/lib/verify.ts        Comprobaciones públicas (FASE 4)
src/lib/artifacts.ts     Registro de despliegues
src/lib/args.ts          Opciones compatibles con npm 12
src/lib/log.ts           Salida + bloque QUÉ/POR QUÉ/CUÁNTO/DINERO/REVERSIBLE
docs/                    Análisis de las FASES 6, 7.1 y el runbook de la 8
```

### Los dos perfiles

`config/token.config.ts` tiene **`devnet`** y **`mainnet`**, y el cluster elige
cuál se usa. No es duplicación por descuido:

- **`devnet`** está cerrado, para poder probar el flujo entero.
- **`mainnet`** está **bloqueado a propósito**: las decisiones de §4.4, §7.1 y
  §7.3 son del operador. `assertProfileReadyForLaunch('mainnet')` lanza mientras
  sigan abiertas, y hay tests que comprueban que **siguen** abiertas.

Que devnet funcione no desbloquea mainnet.

---

## Decisiones deliberadamente sin tomar

- **Asignación del fundador** (3% / 5% / 10%) — §7.1
  → [análisis y recomendación](docs/ANALISIS-7.1-asignacion-fundador.md)
- **SPL clásico vs Token-2022** — §4.4 (el código soporta ambos)
- **Revocación de autoridades** — §7.3, **irreversible**
- **Vesting / lock** — §7.2, sin analizar
- **Hosting de metadata** — §4.5, las dos opciones documentadas en `metadata:build`
- **Capital de liquidez** — la cifra que condiciona todo el lanzamiento

---

## Documentación

- [FASE 6 — comparativa de mecanismos](docs/FASE6-mecanismos.md) — Pump.fun vs
  DEX propio, con lo verificado y lo **no** verificado claramente separado
- [§7.1 — asignación del fundador](docs/ANALISIS-7.1-asignacion-fundador.md)
- [FASE 8 — runbook de mainnet](docs/FASE8-runbook-mainnet.md) — **no ejecutado**

---

## Fases

Ver la tabla de estado en [`CONTEXTO.md` §8](CONTEXTO.md). Nada que cueste dinero
real se ejecuta sin autorización explícita del operador.
