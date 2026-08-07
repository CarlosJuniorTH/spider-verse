/**
 * estimate-cost.ts — estima el coste de crear el token. SOLO LECTURA.
 *
 * QUÉ:        pregunta al RPC el rent exento de cada cuenta necesaria y la fee
 *             base de una transacción, y compone el total.
 * POR QUÉ:    CONTEXTO.md §2.3 exige coste exacto ANTES de cualquier operación
 *             de mainnet, calculado con datos actuales, no de memoria.
 * CUÁNTO:     0 SOL. Las consultas RPC son gratuitas y no firman nada.
 * DINERO REAL: No.
 * REVERSIBLE: N/A — no modifica nada.
 *
 * ⚠ LO QUE ESTE SCRIPT **NO** CUBRE:
 *   comisiones de Pump.fun / PumpSwap / Raydium / Meteora / Orca / Jupiter,
 *   ni el capital de liquidez inicial. Eso se consultará en documentación
 *   oficial y actual en las FASES 6-7. No se asume nada de memoria.
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, formatSol } from '../src/lib/cluster.js';
import { estimateTokenCreationCost, toFiat } from '../src/lib/cost.js';
import { profileFor } from '../config/token.config.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();

  declareReadOnly(
    'Estimar el coste en SOL de crear el token (rent + fees), preguntando al RPC',
    'Conocer el coste exacto antes de plantear cualquier operación con dinero real (§2.3)',
    cluster,
  );

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const est = await estimateTokenCreationCost(connection);

  log.title(`Rent exento — consultado en vivo a ${cluster.endpoint}`);
  for (const line of est.rentLines) {
    log.kv(line.label, `${formatSol(line.lamports)}  (${line.bytes} bytes)`);
    log.dim(`      ${line.recoverable ? 'RECUPERABLE' : 'NO recuperable'} — ${line.note ?? ''}`);
  }

  log.title('Fees de transacción — consultadas en vivo');
  log.kv('Fee base (1 firma)', formatSol(est.fee.lamportsPerSignature));
  log.kv(
    'Fee de prioridad reciente',
    est.fee.recentPriorityFeeMicroLamports === null
      ? 'no disponible en este RPC'
      : `${est.fee.recentPriorityFeeMicroLamports} micro-lamports / unidad de cómputo (mediana reciente)`,
  );
  log.kv('Transacciones asumidas', `${est.assumedTransactions} (crear mint · crear ATA + mint_to · metadata)`);

  log.title('TOTAL estimado');
  log.kv('Rent', formatSol(est.totalRentLamports));
  log.kv('Fees', formatSol(est.totalFeeLamports));
  log.kv('TOTAL', formatSol(est.totalLamports));
  log.kv('  del cual recuperable', `${formatSol(est.totalRecoverableLamports)} (rent de cuentas cerrables)`);
  log.kv(
    '  del cual NO recuperable',
    formatSol(est.totalLamports - est.totalRecoverableLamports),
  );

  const fiat = toFiat(est.totalLamports);
  log.title('Conversión a fiat');
  if (fiat.usd === null) {
    log.warn(fiat.note);
    log.info('Consulta la cotización actual de SOL y ponla en .env (SOL_PRICE_USD, EUR_PER_USD).');
  } else {
    log.kv('USD', `≈ ${fiat.usd.toFixed(4)} $`);
    log.kv('EUR', fiat.eur === null ? 'EUR_PER_USD vacío en .env' : `≈ ${fiat.eur.toFixed(4)} €`);
    log.dim(`      ${fiat.note}`);
  }

  log.title('Avisos');
  if (cluster.isMainnet) {
    log.warn('Cifras de MAINNET: representan dinero real. Aun así, este script no ha gastado nada.');
  } else {
    log.ok(`Cifras leídas de ${cluster.name}. El rent es idéntico en mainnet (misma fórmula); las fees`);
    log.ok('de prioridad sí varían con la congestión real de mainnet.');
  }
  log.warn('NO incluye: comisiones de Pump.fun/PumpSwap/Raydium/Meteora/Orca/Jupiter,');
  log.warn('ni el capital de liquidez inicial. Se consultarán en documentación oficial en FASE 6-7.');
  const profile = profileFor(cluster.name);
  log.dim(`      Configuración actual: ${profile.name} (${profile.symbol}), programa: ${profile.tokenProgram}.`);
  log.dim('      Si tokenProgram acaba siendo token-2022, los tamaños de cuenta cambian y esta');
  log.dim('      estimación debe recalcularse (§4.4).');
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
