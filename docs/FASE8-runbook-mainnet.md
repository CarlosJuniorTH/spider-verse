# FASE 8 — Runbook de lanzamiento en mainnet

> **ESTADO: PREPARADO. NO EJECUTADO.**
>
> Nada de este documento se ha ejecutado. CONTEXTO.md §2.3 y §8 exigen
> autorización explícita del operador antes de cualquier gasto real, y esa
> autorización **no se ha dado**. Este fichero es el procedimiento, no un
> registro de algo que haya pasado.

---

## 0. Bloqueos activos ahora mismo

El código **impide** ejecutar la FASE 8 hoy. No por disciplina: por diseño.
Estos son los cerrojos, y cuáles siguen echados:

| Cerrojo | Estado | Cómo se abre |
| --- | --- | --- |
| `mainnet.tokenProgram` sin decidir (§4.4) | 🔒 **cerrado** | decidir SPL clásico vs Token-2022 |
| `mainnet.founderAllocation` sin decidir (§7.1) | 🔒 **cerrado** | ver [análisis](ANALISIS-7.1-asignacion-fundador.md) |
| `mainnet.allocations` vacío | 🔒 **cerrado** | depende de §7.1 |
| Las tres autoridades sin decidir (§7.3) | 🔒 **cerrado** | decidir qué revocar y cuándo |
| Nombre y símbolo son `PLACEHOLDER`/`PLACE` | 🔒 **cerrado** | elegirlos |
| `METADATA_URI` sin definir (§4.5) | 🔒 **cerrado** | subir el JSON y ponerlo en `.env` |
| `ALLOW_MAINNET=false` | 🔒 **cerrado** | decisión consciente en `.env` |
| `I_UNDERSTAND_THIS_SPENDS_REAL_MONEY=false` | 🔒 **cerrado** | decisión consciente en `.env` |
| Frase escrita en un TTY | 🔒 **cerrado** | teclear `SI, GASTAR EN MAINNET` |
| §7.2 vesting/lock | ⬜ **sin analizar** | queda pendiente |
| Capital de liquidez | ⬜ **sin cifra** | ver [FASE 6 §3](FASE6-mecanismos.md) |

`npm run preflight` los enumera en cada ejecución. Mientras haya cerrojos
cerrados, `assertProfileReadyForLaunch('mainnet')` lanza y `token:create` ni
siquiera llega a construir una transacción.

---

## 1. Requisitos previos (todos obligatorios)

1. **Todo lo anterior probado en devnet de punta a punta**, con
   `npm run verify:all -- strict` en verde.
2. **Decisiones §4.4, §7.1, §7.2 y §7.3 cerradas** en `config/token.config.ts`,
   perfil `mainnet`.
3. **Metadata alojada y accesible** — `npm run verify:metadata` debe confirmar
   que la URI y la imagen responden HTTP 200. Si la URI falla y luego revocas
   `updateAuthority`, el error es permanente.
4. **Presupuesto revalidado**: `npm run budget:mainnet` con las cifras de pool y
   liquidez **consultadas ese mismo día** (las de FASE 6 caducan).
5. **SOL real en la wallet**, con margen sobre el presupuesto.
6. **Autorización explícita del operador**, en este chat, después de ver el
   presupuesto.

---

## 2. Secuencia

El orden importa y no es negociable: cada paso depende del anterior, y el último
es irreversible.

```bash
npm run preflight
```

```bash
npm run budget:mainnet -- pool-sol=<CONSULTADO> liquidity-sol=<TU_CIFRA> sol-usd=<HOY> eur-usd=<HOY>
```

**⏸ PARADA OBLIGATORIA.** Aquí se para y se espera autorización. §2.3.

```bash
npm run simulate:launch
```

Con `CLUSTER=mainnet-beta` y `DRY_RUN` forzado: simula todo sin firmar nada.
Si algo falla aquí, falla también de verdad. **Sigue sin costar nada.**

```bash
npm run token:create
```

Primera operación con dinero real. Pedirá la frase de confirmación.
Crea el mint, las cuentas y acuña el supply. **Irreversible.**

```bash
npm run metadata:attach
```

```bash
npm run verify:all -- strict
```

**⏸ SEGUNDA PARADA.** Si esto no está impecable, no se sigue. Revisar y corregir
es posible **ahora**; después de revocar autoridades ya no.

```bash
npm run authorities:revoke -- mint update
```

**⚠ EL PASO IRREVERSIBLE.** Pedirá escribir `REVOCAR PARA SIEMPRE`.
Después de esto no se puede acuñar ni corregir la metadata nunca más.

```bash
npm run verify:all -- strict
```

Última comprobación, releyendo la cadena.

### Solo entonces: liquidez

La creación del pool no está en este repositorio. Es una operación en la interfaz
del DEX elegido (ver [FASE 6](FASE6-mecanismos.md)). Se hace **después** de que
todo lo anterior esté verificado.

---

## 3. Qué NO hacer

De §2.1, y sin matices:

- No crear volumen artificial, ni con bots ni con wallets propias.
- No trocear la asignación del fundador entre varias direcciones.
- No mantener `freezeAuthority` viva "por si acaso": es el mecanismo del honeypot.
- No pagar promoción para "aparecer" en trackers — la indexación es gratis
  ([FASE 6 §0](FASE6-mecanismos.md)).
- No revocar `updateAuthority` antes de confirmar que la metadata es correcta.
- No lanzar sin haber probado el flujo completo en devnet.

---

## 4. Registro

`npm run token:create` escribe `artifacts/mainnet-beta/<mint>.json` con mint,
firmas, autoridades, distribución y coste real. **Ese fichero sí se versiona a
mano**: es el registro público de transparencia del §1. Solo los de devnet están
en `.gitignore`, porque se regeneran.

---

## 5. Estado a 7 de agosto de 2026

- Fases 1-7 completadas.
- Devnet: el flujo está construido y simulado; **no se ha llegado a crear el
  token** porque el faucet público de devnet lleva todo el día devolviendo 429
  y la wallet sigue a 0 SOL.
- Mainnet: **no se ha tocado**. Cero gasto. Cero transacciones firmadas.
