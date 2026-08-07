/**
 * wallet-new.ts — genera un keypair NUEVO fuera del repositorio.
 *
 * QUÉ:        crea un par de claves ed25519 y lo guarda en KEYPAIR_PATH.
 * POR QUÉ:    necesitamos una wallet de devnet para las FASES 2-5.
 * CUÁNTO:     0 SOL. No toca la red. No firma nada.
 * DINERO REAL: No.
 * REVERSIBLE: Sí — basta con borrar el fichero. Pero OJO: si algún día esa
 *             wallet tiene fondos o autoridades, borrarla es IRREVERSIBLE.
 *
 * No se genera ni se pide NINGUNA seed phrase en ningún punto del proyecto.
 */

import { action, log } from '../src/lib/log.js';
import { env, KEYS_DIR } from '../src/lib/env.js';
import { createKeypairFile, WalletError } from '../src/lib/wallet.js';
import { resolveCluster, explorerUrl } from '../src/lib/cluster.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();

  action({
    what: `Generar un keypair nuevo y guardarlo en ${env.KEYPAIR_PATH}`,
    why: 'Necesitamos una wallet propia para operar en devnet (FASE 1-5)',
    cost: '0 SOL — generación local, no se envía nada a la red',
    realMoney: false,
    reversible: 'Sí ahora (fichero recién creado y sin fondos). NO lo será si esa wallet acumula fondos o autoridades.',
    cluster: cluster.name,
  });

  if (cluster.isMainnet) {
    log.warn('CLUSTER=mainnet-beta. Se puede generar la clave igualmente (es local y gratis),');
    log.warn('pero recuerda: durante el desarrollo CLUSTER debe ser devnet.');
  }

  const { publicKey, keypairPath } = createKeypairFile();

  log.ok('Keypair creado.');
  log.kv('Pubkey', publicKey.toBase58());
  log.kv('Fichero', keypairPath);
  log.kv('Directorio de claves', KEYS_DIR);
  log.kv('Explorer', explorerUrl('address', publicKey.toBase58(), cluster));

  log.plain('');
  log.warn('La clave privada NO se ha mostrado y no se mostrará nunca. Está solo en ese fichero.');
  log.warn('En Windows los permisos POSIX (chmod 600) son casi simbólicos: ese fichero está');
  log.warn('protegido de facto solo por los permisos NTFS de tu usuario. No lo copies al repo,');
  log.warn('no lo subas a la nube y no lo pegues en ningún chat.');
  log.plain('');
  log.info('Siguiente:  npm run airdrop      (SOL de devnet, sin valor)');
  log.info('            npm run balance');
}

main().catch((err: unknown) => {
  if (err instanceof WalletError) {
    log.error(err.message);
  } else {
    log.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
