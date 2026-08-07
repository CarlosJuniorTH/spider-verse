/**
 * authorities-revoke.ts — §7.3. Revoca autoridades del token.
 *
 * ⚠⚠ ESTE ES EL SCRIPT MÁS PELIGROSO DEL PROYECTO. ⚠⚠
 *
 * QUÉ:        pone a `null` mintAuthority y/o updateAuthority.
 * POR QUÉ:    un token con mintAuthority viva puede acuñar supply infinito, y
 *             los analizadores (RugCheck, DexScreener, Birdeye) lo marcan como
 *             riesgo. Revocar es la señal estándar de "no puedo diluirte".
 * CUÁNTO:     una fee por transacción. Céntimos.
 * DINERO REAL: solo en mainnet, con el gate completo.
 * REVERSIBLE: **NO. JAMÁS. EN NINGÚN CASO.**
 *
 * Consecuencias, para que consten antes de ejecutar:
 *   · mintAuthority   → nunca más se podrán acuñar tokens. Ni uno.
 *   · updateAuthority → la metadata (nombre, símbolo, imagen, URI) queda
 *                       congelada para siempre. Una errata es permanente.
 *
 * ORDEN CORRECTO: crear → acuñar → metadata → VERIFICAR TODO → y solo entonces
 * revocar. Por eso este paso está separado y no ocurre solo.
 *
 * Uso:
 *   npm run authorities:revoke -- --mint            (solo mintAuthority)
 *   npm run authorities:revoke -- --update          (solo updateAuthority)
 *   npm run authorities:revoke -- --mint --update
 *   añade --dry-run para simular
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PublicKey } from '@solana/web3.js';
import { AuthorityType, createSetAuthorityInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, publicKey, signerIdentity, none } from '@metaplex-foundation/umi';
import { updateV1, fetchMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';

import { action, log, colors } from '../src/lib/log.js';
import { resolveCluster, getConnection, explorerUrl } from '../src/lib/cluster.js';
import { loadKeypair } from '../src/lib/wallet.js';
import { assertClusterMatchesRpc } from '../src/lib/guard.js';
import { sendTransaction, recommendedPriorityFee, isDryRun, TxError } from '../src/lib/tx.js';
import { loadLatestArtifact, resolveMintArg, saveArtifact } from '../src/lib/artifacts.js';
import { readMint, readMetadata } from '../src/lib/inspect.js';
import { hasFlag } from '../src/lib/args.js';

const CONFIRM_PHRASE = 'REVOCAR PARA SIEMPRE';

async function confirmIrreversible(targets: string[], cluster: string): Promise<void> {
  log.title(`${colors.red}${colors.bold}ACCIÓN IRREVERSIBLE${colors.reset}`);
  for (const t of targets) log.plain(`  · ${t}`);
  log.plain('');
  log.warn('Esto NO se puede deshacer. No hay recuperación, ni con soporte, ni con otra clave.');

  if (!stdin.isTTY) {
    throw new Error('Se requiere confirmación interactiva y esta sesión no es un terminal. Cancelado.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    log.plain('');
    log.plain(`Red: ${cluster}. Para continuar escribe exactamente:  ${CONFIRM_PHRASE}`);
    const answer = (await rl.question('> ')).trim();
    if (answer !== CONFIRM_PHRASE) {
      throw new Error('Confirmación incorrecta. CANCELADO. No se ha revocado nada.');
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const dryRun = isDryRun();

  const doMint = hasFlag('mint');
  const doUpdate = hasFlag('update');
  if (!doMint && !doUpdate) {
    throw new Error(
      'No has indicado qué revocar. Es a propósito: este script nunca actúa por defecto.\n' +
        '  mint      revoca mintAuthority   (no se podrá acuñar nunca más)\n' +
        '  update    revoca updateAuthority (la metadata queda congelada)\n' +
        '  dry-run   simula sin ejecutar\n' +
        '\n' +
        'Ejemplo:  npm run authorities:revoke -- mint update dry-run',
    );
  }

  const mintAddress = resolveMintArg(cluster.name);
  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);
  const payer = loadKeypair();

  // ── Estado actual, leído de la cadena ────────────────────────────────────
  const mintState = await readMint(connection, mintAddress);
  const meta = await readMetadata(connection, mintAddress);

  log.title('Estado ACTUAL en la cadena');
  log.kv('Mint', mintAddress);
  log.kv('Supply', mintState.supply.toString());
  log.kv('mintAuthority', mintState.mintAuthority ?? 'ya revocada');
  log.kv('freezeAuthority', mintState.freezeAuthority ?? 'ya revocada / nunca existió');
  log.kv('updateAuthority', meta.updateAuthority ?? 'sin metadata');
  log.kv('metadata', meta.exists ? `${meta.name} / ${meta.symbol} → ${meta.uri}` : 'NO EXISTE');

  // ── Comprobaciones de sensatez antes de destruir nada ────────────────────
  const targets: string[] = [];

  if (doMint) {
    if (mintState.mintAuthority === null) {
      log.warn('mintAuthority ya está revocada. Nada que hacer.');
    } else if (mintState.mintAuthority !== payer.publicKey.toBase58()) {
      throw new Error(
        `No eres la mintAuthority. Es ${mintState.mintAuthority} y tu wallet es ${payer.publicKey.toBase58()}.`,
      );
    } else {
      if (mintState.supply === 0n) {
        throw new Error(
          'El supply es 0. Revocar mintAuthority ahora dejaría un token que NUNCA podrá tener tokens.\n' +
            'Acuña el supply primero:  npm run token:create',
        );
      }
      if (!meta.exists) {
        throw new Error(
          'La metadata NO existe todavía y crearla requiere la mintAuthority.\n' +
            'Adjunta la metadata primero:  npm run metadata:attach',
        );
      }
      targets.push('mintAuthority → null : no se podrá acuñar ni un token más, nunca.');
    }
  }

  if (doUpdate) {
    if (!meta.exists) {
      throw new Error('No hay cuenta de metadata, así que no hay updateAuthority que revocar.');
    } else if (meta.updateAuthority !== payer.publicKey.toBase58()) {
      throw new Error(
        `No eres la updateAuthority. Es ${meta.updateAuthority} y tu wallet es ${payer.publicKey.toBase58()}.`,
      );
    } else if (meta.uri === null || meta.uri === '' || /PENDIENTE/i.test(meta.uri)) {
      throw new Error(
        `La URI de metadata es «${meta.uri}», que no parece definitiva.\n` +
          'Congelarla ahora dejaría el token sin logo ni descripción PARA SIEMPRE.',
      );
    } else {
      targets.push('updateAuthority → null : nombre, símbolo, imagen y URI quedan congelados para siempre.');
    }
  }

  if (targets.length === 0) {
    log.ok('No hay nada que revocar. Salgo sin tocar nada.');
    return;
  }

  action({
    what: `Revocar: ${targets.length} autoridad(es) del mint ${mintAddress}`,
    why: 'Una autoridad viva es un riesgo de dilución o de cambio de metadata (§7.3)',
    cost: 'una fee de transacción (céntimos)',
    realMoney: cluster.isMainnet,
    reversible: 'NO. Es permanente e irrecuperable.',
    cluster: cluster.name,
  });

  await confirmIrreversible(targets, cluster.name);

  const priorityFee = await recommendedPriorityFee(connection, cluster.isMainnet);
  const instructions = [];

  if (doMint && mintState.mintAuthority !== null) {
    const programId = mintState.programName === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    instructions.push(
      createSetAuthorityInstruction(
        new PublicKey(mintAddress),
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
        [],
        programId,
      ),
    );
  }

  if (doUpdate && meta.exists) {
    const umi = createUmi(cluster.endpoint);
    const authority = createNoopSigner(publicKey(payer.publicKey.toBase58()));
    umi.use(signerIdentity(authority));
    const current = await fetchMetadataFromSeeds(umi, { mint: publicKey(mintAddress) });
    const builder = updateV1(umi, {
      mint: publicKey(mintAddress),
      authority,
      data: current,
      newUpdateAuthority: none(),
      isMutable: false,
    });
    for (const ix of builder.getInstructions()) instructions.push(toWeb3JsInstruction(ix));
  }

  const result = await sendTransaction(connection, {
    label: 'revocar autoridades',
    payer,
    priorityFeeMicroLamports: priorityFee,
    instructions,
  });

  if (dryRun) {
    log.title('DRY-RUN COMPLETADO');
    log.ok('La revocación simula correctamente. NO se ha revocado nada.');
    return;
  }

  // ── Releer la cadena: no nos fiamos de que la tx dijera "ok" ──────────────
  const after = await readMint(connection, mintAddress);
  const metaAfter = await readMetadata(connection, mintAddress);

  log.title('Estado DESPUÉS (releído de la cadena)');
  log.kv('mintAuthority', after.mintAuthority ?? `${colors.green}revocada${colors.reset}`);
  log.kv('freezeAuthority', after.freezeAuthority ?? `${colors.green}revocada${colors.reset}`);
  log.kv('updateAuthority', metaAfter.updateAuthority ?? `${colors.green}revocada${colors.reset}`);
  log.kv('Firma', result.signature ?? '');
  log.kv('Explorer', explorerUrl('address', mintAddress, cluster));

  const artifact = loadLatestArtifact(cluster.name);
  if (artifact !== null && artifact.mint === mintAddress) {
    artifact.authorities.mint = after.mintAuthority;
    artifact.authorities.freeze = after.freezeAuthority;
    artifact.authorities.update = metaAfter.updateAuthority;
    artifact.signatures['revocar-autoridades'] = result.signature ?? '';
    artifact.notes.push(`Autoridades revocadas: ${targets.length}. Irreversible.`);
    saveArtifact(artifact);
  }
}

main().catch((err: unknown) => {
  if (err instanceof TxError) {
    log.error(err.message);
  } else {
    log.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
