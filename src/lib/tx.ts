/**
 * tx.ts — construcción, simulación y envío de transacciones.
 *
 * Dos principios:
 *  1. **Simular siempre antes de firmar.** Una simulación es gratis y detecta
 *     el 90% de los errores antes de gastar la fee.
 *  2. **Modo dry-run de primera clase.** `DRY_RUN=1` recorre todo el flujo real
 *     (construye, simula, calcula coste) y se detiene justo antes de firmar.
 *     Es lo que hace posible la FASE 5: simular el lanzamiento sin gastar.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  type Signer,
  type SimulatedTransactionResponse,
} from '@solana/web3.js';
import { log } from './log.js';
import { formatSol } from './cluster.js';
import { hasFlag } from './args.js';

export class TxError extends Error {
  constructor(
    message: string,
    readonly logs?: string[],
  ) {
    super(message);
  }
}

/** ¿Estamos en modo simulación? Ver `args.ts` para las formas admitidas. */
export function isDryRun(): boolean {
  return hasFlag('dry-run');
}

export interface SendOptions {
  /** Etiqueta legible para los logs. */
  label: string;
  /** Instrucciones de la transacción. */
  instructions: TransactionInstruction[];
  /** Quien paga las fees. Debe poder firmar. */
  payer: Keypair;
  /** Firmantes adicionales (p. ej. el keypair del mint recién creado). */
  extraSigners?: Signer[];
  /**
   * Micro-lamports por unidad de cómputo. 0 = sin fee de prioridad.
   * En devnet no hace falta; en mainnet se calcula desde `getRecentPrioritizationFees`.
   */
  priorityFeeMicroLamports?: number;
  /** Límite de unidades de cómputo. Si se omite, se toma el de la simulación. */
  computeUnitLimit?: number;
}

export interface SendResult {
  /** null en dry-run: no se ha firmado nada. */
  signature: string | null;
  /** Fee que habría costado / ha costado, en lamports. */
  feeLamports: number;
  /** Unidades de cómputo consumidas según la simulación. */
  unitsConsumed: number | null;
  dryRun: boolean;
  simulationLogs: string[];
}

function buildTransaction(opts: SendOptions, blockhash: string): Transaction {
  const tx = new Transaction();

  if (opts.computeUnitLimit !== undefined) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit }));
  }
  if (opts.priorityFeeMicroLamports !== undefined && opts.priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.priorityFeeMicroLamports }));
  }

  for (const ix of opts.instructions) tx.add(ix);

  tx.recentBlockhash = blockhash;
  tx.feePayer = opts.payer.publicKey;
  return tx;
}

function describeSimulationFailure(sim: SimulatedTransactionResponse): string {
  const err = JSON.stringify(sim.err);
  const logs = sim.logs ?? [];

  // Traducimos los errores más frecuentes a algo accionable.
  if (logs.some((l) => /insufficient lamports|insufficient funds/i.test(l)) || /InsufficientFundsForRent/.test(err)) {
    return 'saldo insuficiente en la wallet para pagar rent + fees';
  }
  if (/AccountInUse|already in use/i.test(err + logs.join(' '))) {
    return 'la cuenta ya existe (¿el token ya estaba creado?)';
  }
  return `la red rechazó la transacción: ${err}`;
}

/**
 * Construye → simula → (si no es dry-run) firma, envía y confirma.
 * Nunca firma sin haber simulado antes.
 */
export async function sendTransaction(connection: Connection, opts: SendOptions): Promise<SendResult> {
  const dryRun = isDryRun();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = buildTransaction(opts, blockhash);

  const signers = [opts.payer, ...(opts.extraSigners ?? [])];

  // ── 1. Simulación (gratis, obligatoria) ──────────────────────────────────
  log.dim(`      simulando «${opts.label}»…`);
  tx.sign(...signers); // firmar en local no cuesta nada ni envía nada
  const sim = await connection.simulateTransaction(tx);

  const simulationLogs = sim.value.logs ?? [];
  const unitsConsumed = sim.value.unitsConsumed ?? null;

  if (sim.value.err !== null) {
    throw new TxError(`«${opts.label}» falló en SIMULACIÓN — ${describeSimulationFailure(sim.value)}`, simulationLogs);
  }

  // ── 2. Coste ─────────────────────────────────────────────────────────────
  const feeRes = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
  const feeLamports = feeRes.value ?? 0;

  log.dim(`      simulación OK · ${unitsConsumed ?? '?'} CU · fee ${formatSol(feeLamports)}`);

  // ── 3. Envío ─────────────────────────────────────────────────────────────
  if (dryRun) {
    log.warn(`      DRY-RUN: «${opts.label}» NO se ha enviado. Nada firmado en la red.`);
    return { signature: null, feeLamports, unitsConsumed, dryRun: true, simulationLogs };
  }

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (conf.value.err !== null) {
    throw new TxError(`«${opts.label}» se envió pero FALLÓ on-chain: ${JSON.stringify(conf.value.err)}`);
  }

  log.ok(`      «${opts.label}» confirmada · ${signature}`);
  return { signature, feeLamports, unitsConsumed, dryRun: false, simulationLogs };
}

/**
 * Fee de prioridad recomendada para el cluster, consultada en vivo.
 * En devnet devuelve 0: no hay congestión que justifique pagar de más.
 */
export async function recommendedPriorityFee(connection: Connection, isMainnet: boolean): Promise<number> {
  if (!isMainnet) return 0;
  try {
    const fees = await connection.getRecentPrioritizationFees();
    if (fees.length === 0) return 0;
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    // Percentil 75: pasar sin pagar el pico.
    return sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  } catch {
    return 0;
  }
}
