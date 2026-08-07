/**
 * airdrop.ts — pide SOL de PRUEBA en devnet.
 *
 * QUÉ:        `requestAirdrop` al faucet de devnet.
 * POR QUÉ:    necesitamos saldo para pagar rent y fees de las pruebas (FASE 2-5).
 * CUÁNTO:     0 €. El SOL de devnet NO tiene valor económico y no es convertible.
 * DINERO REAL: NO. Bloqueado por código si CLUSTER=mainnet-beta.
 * REVERSIBLE: N/A.
 *
 * Uso:  npm run airdrop            (1 SOL)
 *       npm run airdrop -- 2       (2 SOL)
 */

import { assertDevnetOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { action, log } from '../src/lib/log.js';
import { loadPublicKey } from '../src/lib/wallet.js';
import { resolveCluster, getConnection, formatSol, explorerUrl, LAMPORTS_PER_SOL } from '../src/lib/cluster.js';
import { positionals, KNOWN_FLAGS } from '../src/lib/args.js';

/** El faucet de devnet limita la cantidad por petición. Pedimos poco y a menudo. */
const MAX_SOL_PER_REQUEST = 2;

function parseAmount(): number {
  const arg = positionals(KNOWN_FLAGS)[0];
  if (arg === undefined) return 1;
  const n = Number(arg);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Cantidad inválida: "${arg}". Ejemplo:  npm run airdrop -- 2`);
  }
  if (n > MAX_SOL_PER_REQUEST) {
    throw new Error(
      `El faucet de devnet rechaza peticiones grandes. Máximo por petición aquí: ${MAX_SOL_PER_REQUEST} SOL.\n` +
        'Ejecuta el comando varias veces si necesitas más.',
    );
  }
  return n;
}

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const sol = parseAmount();

  action({
    what: `Pedir ${sol} SOL de PRUEBA al faucet de ${cluster.name}`,
    why: 'Tener saldo para pagar rent y fees en las pruebas de devnet',
    cost: '0 € — el SOL de devnet no tiene valor económico ni es convertible',
    realMoney: false,
    reversible: 'N/A — no se puede devolver, pero tampoco tiene valor',
    cluster: cluster.name,
  });

  // Barrera dura: este script NO puede ejecutarse contra mainnet.
  assertDevnetOnly(cluster);

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const pubkey = loadPublicKey();
  const before = await connection.getBalance(pubkey, 'confirmed');
  log.kv('Pubkey', pubkey.toBase58());
  log.kv('Saldo previo', formatSol(before));

  log.plain('');
  log.info('Pidiendo airdrop… (el faucet público de devnet suele estar saturado; puede fallar)');

  let signature: string;
  try {
    signature = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  } catch (err) {
    log.error(`El faucet ha rechazado la petición: ${err instanceof Error ? err.message : String(err)}`);
    log.plain('');
    log.info('Alternativas (todas gratuitas, sin dinero real):');
    log.info('  1. Reintentar en unos minutos, o pedir menos SOL:  npm run airdrop -- 0.5');
    log.info('  2. Faucet web oficial: https://faucet.solana.com  (pega ahí tu PUBKEY, nunca la clave privada)');
    process.exitCode = 1;
    return;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  const after = await connection.getBalance(pubkey, 'confirmed');

  log.ok('Airdrop confirmado.');
  log.kv('Firma', signature);
  log.kv('Saldo nuevo', formatSol(after));
  log.kv('Incremento', formatSol(after - before));
  log.kv('Explorer', explorerUrl('tx', signature, cluster));
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
