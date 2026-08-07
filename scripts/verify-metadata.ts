/**
 * verify-metadata.ts — FASE 4. Metadata on-chain + JSON + imagen.
 *
 * QUÉ:        decodifica la cuenta de metadata, descarga la URI y comprueba
 *             que la imagen existe de verdad.
 * POR QUÉ:    es el fallo más común y más caro: un token con la URI rota se ve
 *             como "Unknown Token" en DexScreener y Birdeye, y si además se ha
 *             revocado `updateAuthority`, ya no tiene arreglo (§7.3).
 * CUÁNTO:     0 SOL. Lecturas RPC + peticiones HTTP a la URI configurada.
 * DINERO REAL: No.  ·  REVERSIBLE: N/A.
 *
 * Uso:  npm run verify:metadata [-- <MINT>]
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { resolveMintArg, isOurMint } from '../src/lib/artifacts.js';
import { metadataPda } from '../src/lib/inspect.js';
import { checkMetadata, printChecks, verdict } from '../src/lib/verify.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  declareReadOnly(
    'Verificar la metadata on-chain, su JSON y su imagen',
    'Una URI rota deja el token como "Unknown Token"; si updateAuthority ya se revocó, no tiene arreglo',
    cluster,
  );

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const mint = resolveMintArg(cluster.name);
  log.kv('Mint', mint);
  log.kv('Metadata PDA', metadataPda(mint).toBase58());
  log.kv('Explorer', explorerUrl('address', mint, cluster));

  const checks = await checkMetadata(connection, mint, cluster.name, isOurMint(cluster.name, mint));
  printChecks('METADATA', checks);
  verdict(checks);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
