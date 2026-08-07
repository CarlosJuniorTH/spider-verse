/**
 * budget-mainnet.ts — FASE 7. Presupuesto exacto de mainnet.
 *
 * QUÉ:        calcula el coste real de lanzar en mainnet, separando lo que
 *             puedo medir de lo que TÚ tienes que consultar y aportar.
 * POR QUÉ:    CONTEXTO.md §2.3 exige, antes de cualquier operación de mainnet:
 *             (1) doc oficial actual, (2) coste exacto en SOL, (3) conversión a
 *             fiat, (4) qué es recuperable y qué no, (5) parar y esperar
 *             autorización.
 * CUÁNTO:     0 SOL. Solo lecturas al RPC de mainnet, que son gratis.
 * DINERO REAL: **No.** Este script calcula; no gasta ni puede gastar.
 * REVERSIBLE: N/A.
 *
 * ── POR QUÉ TE PIDE DATOS EN VEZ DE SABERLOS ────────────────────────────────
 * Las comisiones de Pump.fun, Raydium, Meteora y Jupiter cambian, y algunas se
 * publican como imagen o son configurables por quien despliega (ver
 * docs/FASE6-mecanismos.md). Un número hardcodeado aquí sería mentira en cuanto
 * cambiara. Así que el script mide lo medible y te obliga a introducir el resto
 * tras consultarlo. Es el único modo honesto.
 *
 * Uso:
 *   npm run budget:mainnet
 *   npm run budget:mainnet -- --pool-sol 0.2 --liquidity-sol 5 --sol-usd 180 --eur-usd 0.92
 */

import { log, colors } from '../src/lib/log.js';
import { env } from '../src/lib/env.js';
import { Connection } from '@solana/web3.js';
import { DEFAULT_ENDPOINTS, formatSol, LAMPORTS_PER_SOL } from '../src/lib/cluster.js';
import { estimateTokenCreationCost, METAPLEX_METADATA_ACCOUNT_SIZE, rentFor } from '../src/lib/cost.js';
import { MINT_SIZE, ACCOUNT_SIZE } from '@solana/spl-token';

import { numberOption } from '../src/lib/args.js';

/** Admite `pool-sol=0.2` (npm), `--pool-sol 0.2` (npx tsx) y `POOL_SOL=0.2` (entorno). */
const numArg = (name: string): number | null => numberOption(name.replace(/^--/, ''));

interface Line {
  concept: string;
  lamports: number;
  recoverable: boolean;
  source: 'medido' | 'aportado' | 'pendiente';
  note: string;
}

async function main(): Promise<void> {
  log.title('PRESUPUESTO DE MAINNET — FASE 7');
  log.kv('QUÉ', 'Coste exacto de lanzar en mainnet-beta');
  log.kv('POR QUÉ', 'CONTEXTO.md §2.3 lo exige antes de cualquier gasto real');
  log.kv('CUÁNTO CUESTA', '0 SOL — este script solo lee y calcula');
  log.kv('DINERO REAL', `${colors.green}NO — no puede gastar${colors.reset}`);
  log.kv('REVERSIBLE', 'N/A');

  // ── 1. Medido en mainnet, en vivo ────────────────────────────────────────
  // Nota: se consulta el RPC de mainnet aunque CLUSTER sea devnet. Es una
  // lectura gratuita y es la única forma de tener las cifras reales.
  const endpoint = env.RPC_URL ?? DEFAULT_ENDPOINTS['mainnet-beta'];
  log.title('1 · MEDIDO EN MAINNET (consultado ahora, no de memoria)');
  log.dim(`      RPC: ${endpoint}`);

  const connection = new Connection(endpoint, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    log.warn(`El RPC no sirve mainnet (genesis ${genesis}). Las cifras no serían las reales.`);
  } else {
    log.ok('RPC confirmado como mainnet-beta');
  }

  const est = await estimateTokenCreationCost(connection, 3);
  const [mintRent, ataRent, metaRent] = await Promise.all([
    rentFor(connection, MINT_SIZE),
    rentFor(connection, ACCOUNT_SIZE),
    rentFor(connection, METAPLEX_METADATA_ACCOUNT_SIZE),
  ]);

  const lines: Line[] = [
    {
      concept: 'Rent — cuenta de mint',
      lamports: mintRent,
      recoverable: true,
      source: 'medido',
      note: 'depósito, recuperable solo si cierras el mint (no se hará)',
    },
    {
      concept: 'Rent — token account (ATA)',
      lamports: ataRent,
      recoverable: true,
      source: 'medido',
      note: 'recuperable cerrando la cuenta cuando su saldo sea 0',
    },
    {
      concept: 'Rent — cuenta de metadata',
      lamports: metaRent,
      recoverable: false,
      source: 'medido',
      note: 'no se recupera en la práctica',
    },
    {
      concept: 'Fees de red (3 transacciones)',
      lamports: est.totalFeeLamports,
      recoverable: false,
      source: 'medido',
      note: `${est.fee.lamportsPerSignature} lamports/firma, consultado al RPC`,
    },
  ];

  // Fee de prioridad: solo informativa, depende de la congestión del momento.
  if (est.fee.recentPriorityFeeMicroLamports !== null && est.fee.recentPriorityFeeMicroLamports > 0) {
    // 200.000 CU es un límite típico para estas transacciones.
    const priority = Math.ceil((est.fee.recentPriorityFeeMicroLamports * 200_000 * 3) / 1_000_000);
    lines.push({
      concept: 'Fees de prioridad (estimadas)',
      lamports: priority,
      recoverable: false,
      source: 'medido',
      note: `${est.fee.recentPriorityFeeMicroLamports} µlamports/CU ahora mismo; varía con la congestión`,
    });
  }

  for (const l of lines) {
    log.kv(l.concept, `${formatSol(l.lamports)}${l.recoverable ? '  (recuperable)' : ''}`);
    log.dim(`      ${l.note}`);
  }

  // ── 2. Lo que tienes que aportar tú ──────────────────────────────────────
  log.title('2 · LO QUE DEPENDE DE TI O DE TERCEROS');

  const poolSol = numArg('--pool-sol');
  const liquiditySol = numArg('--liquidity-sol');

  if (poolSol !== null) {
    lines.push({
      concept: 'Creación del pool en el DEX',
      lamports: Math.round(poolSol * LAMPORTS_PER_SOL),
      recoverable: false,
      source: 'aportado',
      note: 'valor que has pasado con --pool-sol. Revalídalo en la doc oficial.',
    });
    log.kv('Creación del pool', `${poolSol} SOL  (aportado por ti)`);
  } else {
    log.warn('Creación del pool: SIN DATO');
    log.dim('      docs/FASE6-mecanismos.md: Raydium CPMM documenta ~0,2 SOL (consultado 2026-08-07).');
    log.dim('      Meteora DBC es configurable por el partner: no existe una cifra fija.');
    log.dim('      Vuelve a consultarlo y pásalo con:  --pool-sol 0.2');
  }

  if (liquiditySol !== null) {
    lines.push({
      concept: 'Capital de liquidez inicial',
      lamports: Math.round(liquiditySol * LAMPORTS_PER_SOL),
      recoverable: true,
      source: 'aportado',
      note: 'NO es una comisión: sigue siendo tuyo dentro del pool, sujeto a pérdida impermanente',
    });
    log.kv('Capital de liquidez', `${liquiditySol} SOL  (aportado por ti)`);
  } else {
    log.warn('Capital de liquidez: SIN DATO — y es la partida que más pesa');
    log.dim('      Jupiter exige que el pool aguante una ida y vuelta de 500 $ con <30 % de');
    log.dim('      diferencia para enrutarte tras el periodo de gracia (~30 días).');
    log.dim('      Un pool demasiado pequeño deja el token sin enrutado. Pásalo con:  --liquidity-sol 5');
  }

  log.plain('');
  log.info('NO se presupuesta nada de esto porque no hace falta (docs/FASE6-mecanismos.md §0):');
  log.dim('      · Indexación en DexScreener → gratuita y automática (pool + 1 transacción)');
  log.dim('      · Routing en Jupiter        → gratuito y automático, si hay liquidez suficiente');
  log.dim('      · "Enhanced Token Info"     → de pago, NO necesario. §7.4: no pagamos promoción.');

  // ── 3. Totales ───────────────────────────────────────────────────────────
  const total = lines.reduce((a, l) => a + l.lamports, 0);
  const recoverable = lines.filter((l) => l.recoverable).reduce((a, l) => a + l.lamports, 0);
  const sunk = total - recoverable;

  log.title('3 · TOTAL');
  log.kv('TOTAL a desembolsar', formatSol(total));
  log.kv('  recuperable', `${formatSol(recoverable)}  (rent + capital de liquidez)`);
  log.kv('  NO recuperable', `${formatSol(sunk)}  (fees y rent de metadata)`);

  // ── 4. Fiat ──────────────────────────────────────────────────────────────
  log.title('4 · CONVERSIÓN A FIAT');
  const solUsd = numArg('--sol-usd') ?? env.SOL_PRICE_USD ?? null;
  const eurUsd = numArg('--eur-usd') ?? env.EUR_PER_USD ?? null;

  if (solUsd === null) {
    log.warn('Sin cotización de SOL. No invento precios.');
    log.dim('      Consúltala y pásala:  --sol-usd 180 --eur-usd 0.92');
    log.dim('      O ponla en .env (SOL_PRICE_USD, EUR_PER_USD).');
  } else {
    const totalSol = total / LAMPORTS_PER_SOL;
    const sunkSol = sunk / LAMPORTS_PER_SOL;
    log.kv('Cotización usada', `1 SOL = ${solUsd} $${eurUsd !== null ? ` · 1 $ = ${eurUsd} €` : ''}`);
    log.kv('TOTAL', `${(totalSol * solUsd).toFixed(2)} $${eurUsd !== null ? ` ≈ ${(totalSol * solUsd * eurUsd).toFixed(2)} €` : ''}`);
    log.kv(
      'Coste hundido real',
      `${(sunkSol * solUsd).toFixed(2)} $${eurUsd !== null ? ` ≈ ${(sunkSol * solUsd * eurUsd).toFixed(2)} €` : ''}`,
    );
    log.dim('      "Coste hundido" = lo que no vuelve pase lo que pase. Es la cifra que importa.');
  }

  // ── 5. Parada obligatoria ────────────────────────────────────────────────
  log.title('5 · PARADA OBLIGATORIA (§2.3)');
  const missing = [poolSol === null && 'coste de creación del pool', liquiditySol === null && 'capital de liquidez']
    .filter((x): x is string => typeof x === 'string');

  if (missing.length > 0) {
    log.warn(`Presupuesto INCOMPLETO. Falta: ${missing.join(' · ')}`);
    log.plain('');
    log.info('Consulta la documentación oficial actual, vuelve a ejecutar con los datos');
    log.info('y entonces tendrás la cifra final.');
  } else {
    log.ok('Presupuesto completo.');
  }

  log.plain('');
  log.plain(`${colors.bold}Este script NO ha gastado nada y NO puede gastar.${colors.reset}`);
  log.plain('Ningún paso de mainnet se ejecutará sin tu autorización explícita:');
  log.dim('      · ALLOW_MAINNET=true en .env');
  log.dim('      · I_UNDERSTAND_THIS_SPENDS_REAL_MONEY=true en .env');
  log.dim('      · y teclear "SI, GASTAR EN MAINNET" en un terminal interactivo');
  log.plain('');
  log.warn('Recordatorio (§9): ningún token nuevo tiene crecimiento garantizado.');
  log.warn('Este presupuesto dice lo que CUESTA, no lo que se recupera.');
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
