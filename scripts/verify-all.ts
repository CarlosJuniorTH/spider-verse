/**
 * verify-all.ts — FASE 4/5. Informe público completo de un token.
 *
 * QUÉ:        ejecuta las cuatro verificaciones y emite un veredicto único.
 * POR QUÉ:    es el documento de transparencia del §1. Está pensado para
 *             pegarlo tal cual y para que cualquiera lo reproduzca contra el
 *             mismo mint y obtenga lo mismo.
 * CUÁNTO:     0 SOL. Solo lectura.
 * DINERO REAL: No.  ·  REVERSIBLE: N/A.
 *
 * Uso:  npm run verify:all [-- <MINT>] [--strict]
 *       --strict: los avisos también hacen fallar. Es el modo que exige el
 *                 chequeo previo a mainnet (FASE 7/8).
 */

import { declareReadOnly, assertClusterMatchesRpc } from '../src/lib/guard.js';
import { log } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { resolveMintArg, isOurMint } from '../src/lib/artifacts.js';
import { hasFlag } from '../src/lib/args.js';
import { formatAmount, metadataPda } from '../src/lib/inspect.js';
import {
  checkSupply,
  checkAuthorities,
  checkMetadata,
  checkDistribution,
  printChecks,
  verdict,
  type Check,
} from '../src/lib/verify.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const strict = hasFlag('strict');

  declareReadOnly(
    'Informe público completo: supply, autoridades, metadata y distribución',
    'Transparencia verificable por terceros (§1): cualquiera puede reproducir este informe',
    cluster,
  );

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const mint = resolveMintArg(cluster.name);
  const ours = isOurMint(cluster.name, mint);

  log.kv('Mint', mint);
  log.kv('Metadata PDA', metadataPda(mint).toBase58());
  log.kv('Explorer', explorerUrl('address', mint, cluster));
  log.kv('Modo', strict ? 'ESTRICTO (los avisos hacen fallar)' : 'normal');
  log.kv('Origen', ours ? 'despliegue nuestro — se compara con token.config.ts' : 'token ajeno — solo se informa');

  const all: Check[] = [];

  const supply = await checkSupply(connection, mint, cluster.name, ours);
  printChecks('1 · SUPPLY', supply);
  all.push(...supply);

  const authorities = await checkAuthorities(connection, mint);
  printChecks('2 · AUTORIDADES', authorities);
  all.push(...authorities);

  const metadata = await checkMetadata(connection, mint, cluster.name, ours);
  printChecks('3 · METADATA', metadata);
  all.push(...metadata);

  const dist = await checkDistribution(connection, mint);
  log.title('4 · DISTRIBUCIÓN');
  dist.holders.slice(0, 10).forEach((h, i) => {
    const pct = `${h.percent.toFixed(2)}%`.padStart(7);
    log.plain(
      `      ${String(i + 1).padStart(2)}  ${pct}  ` +
        `${formatAmount(h.amount, dist.mint.decimals).padStart(22)}   ${h.owner ?? h.tokenAccount}`,
    );
  });
  printChecks('   comprobaciones de concentración', dist.checks);
  all.push(...dist.checks);

  verdict(all, strict);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
