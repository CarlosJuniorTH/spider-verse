/**
 * cost.ts — estimación de coste.
 *
 * REGLA (CONTEXTO.md §2.3): **no hardcodear tarifas**. Todo lo que se puede
 * preguntar a la red, se pregunta a la red:
 *   - el rent exento se calcula con `getMinimumBalanceForRentExemption(size)`
 *   - la fee por transacción se calcula con `getFeeForMessage(mensaje real)`
 *   - la fee de prioridad se consulta con `getRecentPrioritizationFees()`
 *
 * Lo único constante son TAMAÑOS de cuenta (bytes), que son parte del formato
 * de los programas, no parámetros económicos. Aun así van marcados y en FASE 3
 * se verificarán leyendo cuentas reales ya creadas.
 *
 * Este módulo NO cubre las comisiones de Pump.fun, Raydium, Meteora ni Jupiter.
 * Esas se consultarán en documentación oficial y actual en la FASE 6/7, nunca
 * de memoria.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { MINT_SIZE, ACCOUNT_SIZE } from '@solana/spl-token';
import { env } from './env.js';

/**
 * Tamaño de la cuenta de metadata de Metaplex (`MAX_METADATA_LEN`).
 * Es un tamaño de cuenta del programa, no una tarifa.
 *
 * VERIFICADO en devnet (2026-08-07): una cuenta creada con `createV1` y
 * `TokenStandard.Fungible` ocupa realmente **607 bytes**, no 679.
 *
 * Se mantiene 679 a propósito para **estimar**: es el máximo del programa, así
 * que el presupuesto queda ligeramente por encima del coste real (~0,0006 SOL
 * de más). En un presupuesto, pasarse es preferible a quedarse corto.
 * `verify:metadata` informa del tamaño real de cada cuenta.
 */
export const METAPLEX_METADATA_ACCOUNT_SIZE = 679;

/** Tamaño real medido en devnet para un token fungible creado con `createV1`. */
export const METAPLEX_METADATA_MEASURED_SIZE = 607;

export interface RentLine {
  label: string;
  bytes: number;
  lamports: number;
  /** El rent es recuperable si la cuenta puede cerrarse y devolver el depósito. */
  recoverable: boolean;
  note?: string;
}

export interface FeeInfo {
  /** Fee base de una transacción de 1 firma, según el RPC. */
  lamportsPerSignature: number;
  /** Fee de prioridad reciente observada (micro-lamports por unidad de cómputo). */
  recentPriorityFeeMicroLamports: number | null;
}

/** Pregunta al RPC el coste base de una transacción de una firma. */
export async function getBaseTransactionFee(connection: Connection): Promise<number> {
  const payer = Keypair.generate().publicKey;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: PublicKey.default, lamports: 1 }),
    ],
  }).compileToLegacyMessage();

  const res = await connection.getFeeForMessage(message, 'confirmed');
  if (res.value === null) {
    throw new Error('El RPC no ha devuelto fee para el mensaje de prueba (getFeeForMessage → null).');
  }
  return res.value;
}

export async function getFeeInfo(connection: Connection): Promise<FeeInfo> {
  const lamportsPerSignature = await getBaseTransactionFee(connection);

  let recentPriorityFeeMicroLamports: number | null = null;
  try {
    const fees = await connection.getRecentPrioritizationFees();
    if (fees.length > 0) {
      const sorted = [...fees].map((f) => f.prioritizationFee).sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      recentPriorityFeeMicroLamports = mid ?? null;
    }
  } catch {
    // No todos los RPC lo soportan. No es crítico: se reporta como desconocido.
  }

  return { lamportsPerSignature, recentPriorityFeeMicroLamports };
}

/** Rent exento para un tamaño de cuenta arbitrario, preguntado al RPC. */
export async function rentFor(connection: Connection, bytes: number): Promise<number> {
  return connection.getMinimumBalanceForRentExemption(bytes);
}

/**
 * Desglose de rent de las cuentas necesarias para un token SPL clásico
 * con metadata Metaplex. Todo consultado al RPC en vivo.
 */
export async function estimateTokenCreationRent(connection: Connection): Promise<RentLine[]> {
  const [mint, ata, metadata] = await Promise.all([
    rentFor(connection, MINT_SIZE),
    rentFor(connection, ACCOUNT_SIZE),
    rentFor(connection, METAPLEX_METADATA_ACCOUNT_SIZE),
  ]);

  return [
    {
      label: 'Cuenta de mint (SPL Token)',
      bytes: MINT_SIZE,
      lamports: mint,
      recoverable: true,
      note: 'Recuperable solo si el mint se cierra; no se cerrará en un token vivo.',
    },
    {
      label: 'Token account asociada (ATA) del fundador',
      bytes: ACCOUNT_SIZE,
      lamports: ata,
      recoverable: true,
      note: 'Recuperable cerrando la ATA cuando su saldo sea 0.',
    },
    {
      label: 'Cuenta de metadata (Metaplex)',
      bytes: METAPLEX_METADATA_ACCOUNT_SIZE,
      lamports: metadata,
      recoverable: false,
      note: 'Tamaño constante del programa; verificar contra cuenta real en FASE 3.',
    },
  ];
}

export interface CostEstimate {
  rentLines: RentLine[];
  fee: FeeInfo;
  /** Nº de transacciones que se estiman para el flujo completo. */
  assumedTransactions: number;
  totalRentLamports: number;
  totalRecoverableLamports: number;
  totalFeeLamports: number;
  totalLamports: number;
}

export async function estimateTokenCreationCost(
  connection: Connection,
  assumedTransactions = 3,
): Promise<CostEstimate> {
  const [rentLines, fee] = await Promise.all([estimateTokenCreationRent(connection), getFeeInfo(connection)]);

  const totalRentLamports = rentLines.reduce((a, l) => a + l.lamports, 0);
  const totalRecoverableLamports = rentLines.filter((l) => l.recoverable).reduce((a, l) => a + l.lamports, 0);
  const totalFeeLamports = fee.lamportsPerSignature * assumedTransactions;

  return {
    rentLines,
    fee,
    assumedTransactions,
    totalRentLamports,
    totalRecoverableLamports,
    totalFeeLamports,
    totalLamports: totalRentLamports + totalFeeLamports,
  };
}

/**
 * Convierte lamports a fiat SOLO si el operador ha rellenado los precios en .env.
 * Nunca inventa una cotización.
 */
export function toFiat(lamports: number): { usd: number | null; eur: number | null; note: string } {
  const sol = lamports / LAMPORTS_PER_SOL;
  const usdPrice = env.SOL_PRICE_USD;
  const eurPerUsd = env.EUR_PER_USD;

  if (usdPrice === undefined) {
    return {
      usd: null,
      eur: null,
      note: 'SOL_PRICE_USD vacío en .env → no se convierte a fiat (no se inventan cotizaciones).',
    };
  }

  const usd = sol * usdPrice;
  if (eurPerUsd === undefined) {
    return { usd, eur: null, note: 'EUR_PER_USD vacío en .env → solo se muestra USD.' };
  }
  return { usd, eur: usd * eurPerUsd, note: 'Conversión con las cotizaciones puestas a mano en .env.' };
}

export { MINT_SIZE, ACCOUNT_SIZE };
