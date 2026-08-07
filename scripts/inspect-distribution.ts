/**
 * inspect-distribution.ts — FASE 4. Quién tiene el token y en qué proporción.
 *
 * QUÉ:        lista los mayores tenedores y mide la concentración.
 * POR QUÉ:    §7.1. La concentración es lo primero que miran los traders y los
 *             analizadores automáticos (RugCheck, Bubblemaps, la pestaña de
 *             holders de DexScreener). Si la parte del fundador es visible y
 *             está en UNA wallet, esto lo demuestra; si estuviera troceada
 *             entre varias, esto lo delataría.
 * CUÁNTO:     0 SOL. Solo lectura.
 * DINERO REAL: No.  ·  REVERSIBLE: N/A.
 *
 * Uso:  npm run inspect:distribution [-- <MINT>]
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { resolveMintArg } from '../src/lib/artifacts.js';
import { formatAmount } from '../src/lib/inspect.js';
import { checkDistribution, printChecks, verdict } from '../src/lib/verify.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  declareReadOnly(
    'Inspeccionar la distribución de tenedores',
    'La concentración es el primer criterio de desconfianza de traders y analizadores (§7.1)',
    cluster,
  );

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const mint = resolveMintArg(cluster.name);
  log.kv('Mint', mint);
  log.kv('Explorer', explorerUrl('address', mint, cluster));

  const { checks, mint: mintState, holders } = await checkDistribution(connection, mint);

  log.title('MAYORES TENEDORES');
  if (holders.length === 0) {
    log.warn('Ninguna cuenta tiene saldo.');
  } else {
    log.dim('      #   %        cantidad                 propietario');
    holders.forEach((h, i) => {
      const pct = `${h.percent.toFixed(2)}%`.padStart(7);
      const amount = formatAmount(h.amount, mintState.decimals).padStart(22);
      log.plain(`      ${String(i + 1).padStart(2)}  ${pct}  ${amount}   ${h.owner ?? `(ATA ${h.tokenAccount})`}`);
    });
    log.plain('');
    log.dim('      Cada propietario es verificable en el explorador. Nada está oculto (§2.1).');
  }

  printChecks('CONCENTRACIÓN', checks);
  verdict(checks);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
