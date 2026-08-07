/**
 * wallet-show.ts — imprime ÚNICAMENTE la pubkey de la wallet configurada.
 *
 * QUÉ:        lee KEYPAIR_PATH y muestra la clave pública.
 * POR QUÉ:    saber con qué dirección estamos trabajando sin exponer nada.
 * CUÁNTO:     0 SOL. Ni siquiera contacta con la red.
 * DINERO REAL: No.
 * REVERSIBLE: N/A — solo lectura de un fichero local.
 */

import { declareReadOnly } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { env } from '../src/lib/env.js';
import { loadPublicKey, WalletError } from '../src/lib/wallet.js';
import { resolveCluster, explorerUrl } from '../src/lib/cluster.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();

  declareReadOnly(
    'Mostrar la clave PÚBLICA de la wallet configurada',
    'Identificar la dirección con la que se opera, sin exponer material secreto',
    cluster,
  );

  const pubkey = loadPublicKey();

  log.kv('Pubkey', pubkey.toBase58());
  log.kv('Fichero de clave', env.KEYPAIR_PATH);
  log.kv('Red', cluster.name);
  log.kv('Explorer', explorerUrl('address', pubkey.toBase58(), cluster));
  log.plain('');
  log.dim('  (La clave privada nunca se imprime, ni entera ni truncada.)');
}

main().catch((err: unknown) => {
  log.error(err instanceof WalletError || err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
