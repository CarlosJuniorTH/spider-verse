/**
 * verify-supply.ts — FASE 4. Comprueba supply, decimales y si es fijo.
 *
 * QUÉ:        relee el mint de la cadena y lo contrasta con la configuración.
 * POR QUÉ:    "el supply es 1.000 millones y no se puede diluir" tiene que ser
 *             comprobable por cualquiera, no una promesa (§1).
 * CUÁNTO:     0 SOL. Solo lectura.
 * DINERO REAL: No.  ·  REVERSIBLE: N/A.
 *
 * Uso:  npm run verify:supply            (usa el último despliegue)
 *       npm run verify:supply -- <MINT>  (cualquier token, también de otros)
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { resolveMintArg, isOurMint } from '../src/lib/artifacts.js';
import { checkSupply, printChecks, verdict } from '../src/lib/verify.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  declareReadOnly('Verificar supply y decimales contra la cadena', 'El supply declarado debe ser comprobable (§1)', cluster);

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const mint = resolveMintArg(cluster.name);
  log.kv('Mint', mint);
  log.kv('Explorer', explorerUrl('address', mint, cluster));

  const checks = await checkSupply(connection, mint, cluster.name, isOurMint(cluster.name, mint));
  printChecks('SUPPLY', checks);
  verdict(checks);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
