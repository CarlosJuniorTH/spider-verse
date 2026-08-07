/**
 * balance.ts — consulta el saldo en SOL de la wallet configurada.
 *
 * QUÉ:        `getBalance(pubkey)` contra el RPC del cluster.
 * POR QUÉ:    saber si tenemos saldo para las pruebas de devnet.
 * CUÁNTO:     0 SOL. Las lecturas RPC son gratis.
 * DINERO REAL: No.
 * REVERSIBLE: N/A — solo lectura.
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { loadPublicKey } from '../src/lib/wallet.js';
import { resolveCluster, getConnection, formatSol, explorerUrl } from '../src/lib/cluster.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();

  declareReadOnly('Leer el saldo en SOL de la wallet configurada', 'Comprobar fondos disponibles para pruebas', cluster);

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const pubkey = loadPublicKey();
  const lamports = await connection.getBalance(pubkey, 'confirmed');

  log.plain('');
  log.kv('Pubkey', pubkey.toBase58());
  log.kv('RPC', cluster.endpoint);
  log.kv('Saldo', `${formatSol(lamports)}  (${lamports} lamports)`);
  log.kv('Explorer', explorerUrl('address', pubkey.toBase58(), cluster));

  log.plain('');
  if (cluster.isMainnet) {
    log.warn('Estás mirando MAINNET: este saldo es dinero real.');
  } else {
    log.ok(`Red ${cluster.name}: este SOL no tiene ningún valor económico.`);
    if (lamports === 0) log.info('Saldo 0. Consigue SOL de prueba con:  npm run airdrop');
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
