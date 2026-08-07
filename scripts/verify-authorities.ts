/**
 * verify-authorities.ts — FASE 4. Estado real de mint/freeze/updateAuthority.
 *
 * QUÉ:        lee las tres autoridades directamente de la cadena.
 * POR QUÉ:    `freezeAuthority` activa = capacidad de bloquear ventas, que es
 *             justo lo que §2.1 prohíbe. Esto lo demuestra, no lo promete.
 * CUÁNTO:     0 SOL. Solo lectura.
 * DINERO REAL: No.  ·  REVERSIBLE: N/A.
 *
 * Uso:  npm run verify:authorities [-- <MINT>]
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { resolveMintArg } from '../src/lib/artifacts.js';
import { checkAuthorities, printChecks, verdict } from '../src/lib/verify.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  declareReadOnly(
    'Verificar mintAuthority, freezeAuthority y updateAuthority',
    'Una freezeAuthority viva permite bloquear ventas; §2.1 lo prohíbe y esto lo demuestra',
    cluster,
  );

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const mint = resolveMintArg(cluster.name);
  log.kv('Mint', mint);
  log.kv('Explorer', explorerUrl('address', mint, cluster));

  const checks = await checkAuthorities(connection, mint);
  printChecks('AUTORIDADES', checks);

  log.title('Recordatorio (§7.3)');
  log.dim('      Revocar cualquiera de estas autoridades es IRREVERSIBLE.');
  log.dim('      Orden correcto: crear → acuñar → metadata → verificar → revocar.');
  log.dim('      Comando:  npm run authorities:revoke -- --mint --update');

  verdict(checks);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
