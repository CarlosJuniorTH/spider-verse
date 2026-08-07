/**
 * guard.ts — puerta de seguridad para cualquier operación que gaste.
 *
 * CONTEXTO.md §4.3: "ningún script que gaste dinero se ejecuta sin
 *   (a) variable de entorno explícita,
 *   (b) confirmación interactiva escrita,
 *   (c) impresión previa del coste.
 *  Por diseño, no por disciplina del operador."
 *
 * Este módulo es ese diseño. Los scripts de FASE 1 son todos de solo lectura,
 * así que hoy solo se usa `assertDevnetOnly()`; el resto queda listo y probado
 * para cuando llegue la FASE 3 y siguientes.
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { env } from './env.js';
import { resolveCluster, checkGenesisMatchesCluster, formatSol, type ResolvedCluster } from './cluster.js';
import type { Connection } from '@solana/web3.js';
import { log, action } from './log.js';

export class GuardError extends Error {}

/** Frase exacta que hay que teclear para autorizar gasto en mainnet. */
export const MAINNET_CONFIRM_PHRASE = 'SI, GASTAR EN MAINNET';

/** Aborta si el cluster no es devnet/localnet. Para scripts como `airdrop`. */
export function assertDevnetOnly(cluster: ResolvedCluster = resolveCluster()): void {
  if (cluster.isMainnet) {
    throw new GuardError(
      'Esta operación solo tiene sentido en devnet y está bloqueada en mainnet-beta.\n' +
        'Pon CLUSTER=devnet en .env.',
    );
  }
}

/**
 * Verifica contra el RPC que la red es la que decimos. Aborta si no.
 * Esto es lo que impide "creía que estaba en devnet".
 */
export async function assertClusterMatchesRpc(
  connection: Connection,
  cluster: ResolvedCluster = resolveCluster(),
): Promise<void> {
  const check = await checkGenesisMatchesCluster(connection, cluster);
  if (!check.ok) {
    throw new GuardError(check.message);
  }
  log.dim(`  ${check.message}`);
}

export interface SpendRequest {
  /** QUÉ se va a hacer. */
  what: string;
  /** POR QUÉ. */
  why: string;
  /** Coste estimado total en lamports (rent + fees). */
  estimatedLamports: number;
  /** Parte del coste que es rent recuperable al cerrar cuentas. */
  recoverableLamports?: number;
  /** Explicación de reversibilidad. */
  reversible: string;
}

/**
 * Única vía autorizada para ejecutar algo que gasta.
 *
 * En devnet/localnet: informa y sigue (el SOL no vale nada).
 * En mainnet-beta: exige las DOS variables de entorno, imprime el desglose y
 * pide teclear la frase exacta. Si falta cualquier cosa, lanza y no se ejecuta nada.
 */
export async function assertSpendingAuthorized(req: SpendRequest, cluster: ResolvedCluster = resolveCluster()): Promise<void> {
  const recoverable = req.recoverableLamports ?? 0;
  const nonRecoverable = Math.max(0, req.estimatedLamports - recoverable);

  action({
    what: req.what,
    why: req.why,
    cost:
      `${formatSol(req.estimatedLamports)} estimado ` +
      `(recuperable: ${formatSol(recoverable)} · no recuperable: ${formatSol(nonRecoverable)})`,
    realMoney: cluster.isMainnet,
    reversible: req.reversible,
    cluster: cluster.name,
  });

  if (!cluster.isMainnet) {
    log.ok(`Red ${cluster.name}: el SOL no tiene valor económico. Coste real 0 €.`);
    return;
  }

  // ── A partir de aquí: MAINNET. Dinero real. ────────────────────────────────
  log.warn('MAINNET-BETA: esta operación mueve DINERO REAL.');

  if (!env.ALLOW_MAINNET) {
    throw new GuardError('Bloqueado: ALLOW_MAINNET no es true en .env. (CONTEXTO.md §2.3)');
  }
  if (!env.I_UNDERSTAND_THIS_SPENDS_REAL_MONEY) {
    throw new GuardError(
      'Bloqueado: I_UNDERSTAND_THIS_SPENDS_REAL_MONEY no es true en .env. (CONTEXTO.md §2.3)',
    );
  }
  if (!stdin.isTTY) {
    throw new GuardError(
      'Bloqueado: se requiere confirmación interactiva y esta sesión no es un terminal.\n' +
        'No se permite gastar en mainnet desde un proceso no interactivo.',
    );
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    log.plain('');
    log.plain(`Para autorizar, escribe exactamente:  ${MAINNET_CONFIRM_PHRASE}`);
    const answer = (await rl.question('> ')).trim();
    if (answer !== MAINNET_CONFIRM_PHRASE) {
      throw new GuardError('Confirmación incorrecta. Operación CANCELADA. No se ha gastado nada.');
    }
  } finally {
    rl.close();
  }

  log.ok('Autorización recibida.');
}

/**
 * Marca un script como de solo lectura y lo deja constar por pantalla.
 * Todos los scripts de FASE 1 la usan.
 */
export function declareReadOnly(what: string, why: string, cluster: ResolvedCluster = resolveCluster()): void {
  action({
    what,
    why,
    cost: '0 SOL — solo lectura, no se firma ninguna transacción',
    realMoney: false,
    reversible: 'Sí: no modifica nada, ni on-chain ni en disco',
    cluster: cluster.name,
  });
}
