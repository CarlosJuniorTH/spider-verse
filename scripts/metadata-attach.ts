/**
 * metadata-attach.ts — FASE 3. Adjunta la metadata Metaplex al mint.
 *
 * QUÉ:        crea la cuenta de Token Metadata (PDA) con nombre, símbolo y URI.
 * POR QUÉ:    sin esto el token aparece como "Unknown Token" sin nombre ni logo
 *             en wallets, DexScreener, Birdeye y Jupiter. Es lo que lo hace
 *             descubrible (§1).
 * CUÁNTO:     rent de la cuenta de metadata + 1 fee. Se muestra antes de firmar.
 * DINERO REAL: solo en mainnet, y con el gate completo de `guard.ts`.
 * REVERSIBLE: la cuenta se puede actualizar MIENTRAS `updateAuthority` siga
 *             viva. Cuando se revoque, la metadata queda congelada para siempre.
 *
 * Requiere `mintAuthority` viva, por eso `token-create.ts` no la revoca.
 *
 * Modo simulación:  npm run metadata:attach -- --dry-run
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, percentAmount, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import { createV1, findMetadataPda, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';

import { log } from '../src/lib/log.js';
import { env } from '../src/lib/env.js';
import { resolveCluster, getConnection, formatSol, explorerUrl } from '../src/lib/cluster.js';
import { loadKeypair } from '../src/lib/wallet.js';
import { assertClusterMatchesRpc, assertSpendingAuthorized } from '../src/lib/guard.js';
import { sendTransaction, recommendedPriorityFee, isDryRun, TxError } from '../src/lib/tx.js';
import { loadLatestArtifact, resolveMintArg, saveArtifact } from '../src/lib/artifacts.js';
import { rentFor, METAPLEX_METADATA_ACCOUNT_SIZE } from '../src/lib/cost.js';
import { tokenConfig, profileFor, profileNameFor } from '../config/token.config.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const profile = profileFor(cluster.name);
  const profileName = profileNameFor(cluster.name);
  const dryRun = isDryRun();

  const mintAddress = resolveMintArg(cluster.name);
  const uri = env.METADATA_URI ?? profile.metadata.uri;

  if (uri === null || uri === undefined) {
    throw new Error(
      'No hay URI de metadata (§4.5).\n' +
        '  1. npm run metadata:build     → genera assets/metadata.json\n' +
        '  2. Súbelo (GitHub raw o IPFS) y pon la URL en .env como METADATA_URI=…\n' +
        '  3. Vuelve a ejecutar este comando.\n' +
        '  Se puede adjuntar metadata con una URI que aún no resuelva, pero el token se vería\n' +
        '  sin logo ni descripción, que es justo lo que queremos evitar.',
    );
  }

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);
  const payer = loadKeypair();

  // ── Coste ────────────────────────────────────────────────────────────────
  const metadataRent = await rentFor(connection, METAPLEX_METADATA_ACCOUNT_SIZE);
  const priorityFee = await recommendedPriorityFee(connection, cluster.isMainnet);

  await assertSpendingAuthorized(
    {
      what: `Adjuntar metadata Metaplex al mint ${mintAddress} («${profile.name}» / ${profile.symbol})`,
      why: 'Sin metadata el token sale como "Unknown Token" en wallets y agregadores (§1)',
      estimatedLamports: metadataRent + 10_000,
      recoverableLamports: 0,
      reversible:
        'La metadata se puede corregir mientras updateAuthority siga viva. Revocarla la congela para siempre.',
    },
    cluster,
  );

  // ── Construcción vía umi, envío vía nuestro tx.ts ────────────────────────
  // Se usa un firmante "noop" para que umi solo construya las instrucciones;
  // la firma real la pone web3.js. Así TODA transacción del proyecto pasa por
  // el mismo camino: simular → dry-run → enviar.
  const umi = createUmi(cluster.endpoint);
  const authority = createNoopSigner(publicKey(payer.publicKey.toBase58()));
  umi.use(signerIdentity(authority));

  const mint = publicKey(mintAddress);
  const metadataPda = findMetadataPda(umi, { mint });

  log.kv('Mint', mintAddress);
  log.kv('Metadata PDA', metadataPda[0].toString());
  log.kv('name / symbol', `${profile.name} / ${profile.symbol}`);
  log.kv('URI', uri);
  log.kv('sellerFeeBasisPoints', `${profile.metadata.sellerFeeBasisPoints} (0 = sin royalties)`);
  log.kv('isMutable', 'true — se congela al revocar updateAuthority (§7.3)');

  const builder = createV1(umi, {
    mint,
    authority,
    payer: authority,
    updateAuthority: authority,
    name: profile.name,
    symbol: profile.symbol,
    uri,
    sellerFeeBasisPoints: percentAmount(profile.metadata.sellerFeeBasisPoints / 100, 2),
    decimals: tokenConfig.decimals,
    tokenStandard: TokenStandard.Fungible,
    isMutable: true,
    creators: null,
    collection: null,
    uses: null,
  });

  const instructions = builder
    .getInstructions()
    .map((ix) => toWeb3JsInstruction(ix));

  const result = await sendTransaction(connection, {
    label: 'adjuntar metadata',
    payer,
    priorityFeeMicroLamports: priorityFee,
    instructions,
  });

  if (dryRun) {
    log.title('DRY-RUN COMPLETADO');
    log.ok('La transacción de metadata simula correctamente. No se ha enviado nada.');
    return;
  }

  // ── Actualizar el artefacto ──────────────────────────────────────────────
  const artifact = loadLatestArtifact(cluster.name);
  if (artifact !== null && artifact.mint === mintAddress) {
    artifact.metadata = { uri, metadataPda: metadataPda[0].toString() };
    artifact.authorities.update = payer.publicKey.toBase58();
    artifact.signatures['adjuntar-metadata'] = result.signature ?? '';
    artifact.costLamports += metadataRent + result.feeLamports;
    saveArtifact(artifact);
    log.dim('      artefacto actualizado');
  }

  log.title('METADATA ADJUNTADA');
  log.kv('Firma', result.signature ?? '');
  log.kv('Explorer', explorerUrl('address', mintAddress, cluster));
  log.kv('Coste', formatSol(metadataRent + result.feeLamports));
  log.plain('');
  log.info(`Perfil: ${profileName}. Siguiente:  npm run verify:all`);
}

main().catch((err: unknown) => {
  if (err instanceof TxError) {
    log.error(err.message);
    if (err.logs !== undefined && err.logs.length > 0) {
      log.plain('');
      log.dim('  Logs de la simulación:');
      for (const l of err.logs.slice(-15)) log.dim(`      ${l}`);
    }
  } else {
    log.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
