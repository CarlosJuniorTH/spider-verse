/**
 * token-create.ts — FASE 3. Crea el mint, las cuentas y acuña el supply.
 *
 * QUÉ:        (tx1) crea e inicializa el mint · (tx2) crea las ATA y acuña el
 *             supply completo según las asignaciones del perfil.
 * POR QUÉ:    es el token en sí. Todo lo demás cuelga de aquí.
 * CUÁNTO:     rent + fees, calculado en vivo y mostrado ANTES de firmar.
 * DINERO REAL: solo si CLUSTER=mainnet-beta, y entonces `guard.ts` exige
 *             dos variables de entorno + frase escrita en un TTY.
 * REVERSIBLE: **NO.** Un mint creado no se borra. En devnet da igual (juguete);
 *             en mainnet es permanente y público.
 *
 * ── LO QUE ESTE SCRIPT NO HACE, A PROPÓSITO ─────────────────────────────────
 * NO revoca `mintAuthority`. Esa acción es irreversible (§7.3) y además debe ir
 * DESPUÉS de adjuntar la metadata (que necesita esa autoridad). Vive en su
 * propio script, `npm run authorities:revoke`, con su propia confirmación.
 *
 * `freezeAuthority` sí se decide aquí, porque solo puede fijarse al inicializar
 * el mint. Si el perfil dice `revocar`, se pasa `null`: el token nace SIN
 * capacidad de congelar cuentas. Es lo contrario de un honeypot (§2.1).
 *
 * Modo simulación:  npm run token:create -- --dry-run
 */

import { getMinimumBalanceForRentExemptMint } from '@solana/spl-token';

import {
  buildCreateMintInstructions,
  buildMintSupplyInstructions,
  generateMintKeypair,
  tokenProgramIdFor,
} from '../src/lib/token-build.js';
import { log } from '../src/lib/log.js';
import { env } from '../src/lib/env.js';
import { resolveCluster, getConnection, formatSol, explorerUrl } from '../src/lib/cluster.js';
import { loadKeypair } from '../src/lib/wallet.js';
import { assertClusterMatchesRpc, assertSpendingAuthorized } from '../src/lib/guard.js';
import { sendTransaction, recommendedPriorityFee, isDryRun, TxError } from '../src/lib/tx.js';
import { saveArtifact, type AllocationRecord, type DeploymentArtifact } from '../src/lib/artifacts.js';
import { estimateTokenCreationCost } from '../src/lib/cost.js';
import {
  tokenConfig,
  profileFor,
  profileNameFor,
  assertProfileReadyForLaunch,
  totalSupplyBaseUnits,
} from '../config/token.config.js';

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const profileName = profileNameFor(cluster.name);
  const profile = profileFor(cluster.name);
  const dryRun = isDryRun();

  // ── 0. El perfil debe estar cerrado. Si no, aquí se acaba. ────────────────
  assertProfileReadyForLaunch(profileName);

  const tokenProgramId = tokenProgramIdFor(profile);

  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const payer = loadKeypair();

  // ── 1. Coste, ANTES de nada ──────────────────────────────────────────────
  const estimate = await estimateTokenCreationCost(connection, 2);
  const balance = await connection.getBalance(payer.publicKey, 'confirmed');

  await assertSpendingAuthorized(
    {
      what:
        `Crear el token «${profile.name}» (${profile.symbol}) en ${cluster.name}: ` +
        `mint + ${profile.allocations.length} cuenta(s) + acuñar ${tokenConfig.totalSupply.toLocaleString('es-ES')} unidades`,
      why: 'Es la creación del token (FASE 3)',
      estimatedLamports: estimate.totalLamports,
      recoverableLamports: estimate.totalRecoverableLamports,
      reversible:
        'NO. Un mint creado es permanente y público. En devnet es un juguete sin valor; ' +
        'en mainnet no se puede deshacer.',
    },
    cluster,
  );

  log.kv('Pagador', payer.publicKey.toBase58());
  log.kv('Saldo', formatSol(balance));
  log.kv('Programa', `${profile.tokenProgram} (${tokenProgramId.toBase58()})`);

  if (balance < estimate.totalLamports) {
    const msg =
      `Saldo insuficiente: tienes ${formatSol(balance)} y hacen falta ~${formatSol(estimate.totalLamports)}.\n` +
      (cluster.isMainnet ? 'Transfiere SOL a esa wallet.' : 'Consigue SOL de prueba:  npm run airdrop');

    // En dry-run seguimos adelante a propósito: queremos que la SIMULACIÓN se
    // ejecute igualmente. Así se comprueba que las instrucciones están bien
    // construidas, aunque la cuenta no tenga fondos. La simulación no gasta nada.
    if (!dryRun) throw new Error(msg);
    log.warn(msg.split('\n')[0] ?? msg);
    log.dim('      DRY-RUN: se simula igualmente para validar las instrucciones.');
  }

  const priorityFee = await recommendedPriorityFee(connection, cluster.isMainnet);
  if (priorityFee > 0) log.kv('Fee de prioridad', `${priorityFee} micro-lamports/CU`);

  // ── 2. Transacción 1: crear e inicializar el mint ─────────────────────────
  const mintKeypair = generateMintKeypair();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const { instructions: mintIxs, freezeAuthority } = buildCreateMintInstructions({
    payer: payer.publicKey,
    mint: mintKeypair.publicKey,
    decimals: tokenConfig.decimals,
    rentLamports: mintRent,
    profile,
  });
  const revokeFreeze = freezeAuthority === null;

  log.title('Transacción 1 — crear e inicializar el mint');
  log.kv('Mint', mintKeypair.publicKey.toBase58());
  log.kv('decimals', String(tokenConfig.decimals));
  log.kv('mintAuthority', `${payer.publicKey.toBase58()} (se revocará por separado, §7.3)`);
  log.kv(
    'freezeAuthority',
    revokeFreeze
      ? 'null — el token NACE sin capacidad de congelar cuentas (§2.1)'
      : `${payer.publicKey.toBase58()} — ATENCIÓN: se interpretará como riesgo`,
  );

  const tx1 = await sendTransaction(connection, {
    label: 'crear + inicializar mint',
    payer,
    extraSigners: [mintKeypair],
    priorityFeeMicroLamports: priorityFee,
    instructions: mintIxs,
  });

  // ── 3. Transacción 2: cuentas de destino + acuñación ──────────────────────
  log.title('Transacción 2 — cuentas de destino y acuñación del supply');

  const { instructions, targets } = buildMintSupplyInstructions(payer.publicKey, mintKeypair.publicKey, profile);

  const allocationRecords: AllocationRecord[] = targets.map((t) => {
    log.kv(t.label, `${t.percent}% → ${t.owner.toBase58()}`);
    log.dim(`      ATA ${t.ata.toBase58()} · ${t.baseUnits.toString()} unidades base`);
    return {
      label: t.label,
      percent: t.percent,
      wallet: t.owner.toBase58(),
      baseUnits: t.baseUnits.toString(),
      purpose: t.purpose,
    };
  });

  // En dry-run la tx1 NO se ha enviado, así que el mint todavía no existe en la
  // cadena y la tx2 no puede crear cuentas para él. Es una dependencia inherente
  // a simular una secuencia, no un error del código: se informa como tal.
  let tx2: Awaited<ReturnType<typeof sendTransaction>>;
  let tx2Simulated = true;
  try {
    tx2 = await sendTransaction(connection, {
      label: 'crear cuentas + acuñar supply',
      payer,
      priorityFeeMicroLamports: priorityFee,
      instructions,
    });
  } catch (err) {
    const dependsOnTx1 =
      dryRun && err instanceof TxError && /IncorrectProgramId|AccountNotFound|InvalidAccountData/.test(err.message);

    if (!dependsOnTx1) throw err;

    log.warn('La tx2 no se puede simular en dry-run: depende del mint que crea la tx1,');
    log.warn('y en dry-run la tx1 no se ha enviado, así que ese mint todavía no existe.');
    log.dim('      No es un fallo del código. Las instrucciones de la tx2 están verificadas');
    log.dim('      byte a byte en tests/instructions.test.ts, que sí se ejecuta sin red.');
    tx2 = { signature: null, feeLamports: 0, unitsConsumed: null, dryRun: true, simulationLogs: [] };
    tx2Simulated = false;
  }

  // ── 4. Registro público del despliegue ───────────────────────────────────
  if (dryRun) {
    log.title('DRY-RUN COMPLETADO');
    if (tx2Simulated) {
      log.ok('Las dos transacciones simulan correctamente. NO se ha creado nada ni gastado nada.');
    } else {
      log.ok('La tx1 simula correctamente. NO se ha creado nada ni gastado nada.');
      log.warn('La tx2 NO se ha podido simular (depende de la tx1). Queda sin verificar aquí.');
    }
    log.kv('Coste que habría tenido', `${formatSol(mintRent + estimate.totalFeeLamports)} aprox.`);
    log.info('Para ejecutarlo de verdad, repite el comando sin dry-run.');
    return;
  }

  const artifact: DeploymentArtifact = {
    createdAt: new Date().toISOString(),
    cluster: cluster.name,
    mint: mintKeypair.publicKey.toBase58(),
    deployer: payer.publicKey.toBase58(),
    name: profile.name,
    symbol: profile.symbol,
    decimals: tokenConfig.decimals,
    totalSupply: totalSupplyBaseUnits().toString(),
    tokenProgram: profile.tokenProgram,
    allocations: allocationRecords,
    authorities: {
      mint: payer.publicKey.toBase58(),
      freeze: freezeAuthority === null ? null : freezeAuthority.toBase58(),
      update: null,
    },
    metadata: { uri: env.METADATA_URI ?? null, metadataPda: null },
    signatures: {
      'crear-mint': tx1.signature ?? '',
      'acunar-supply': tx2.signature ?? '',
    },
    costLamports: mintRent + tx1.feeLamports + tx2.feeLamports,
    notes: [
      revokeFreeze
        ? 'freezeAuthority = null desde la creación: el token no puede congelar cuentas.'
        : 'freezeAuthority ACTIVA. Revisar §2.1 antes de lanzar.',
      'mintAuthority sigue activa a propósito: hace falta para la metadata. Revocarla es un paso aparte.',
    ],
  };

  const paths = saveArtifact(artifact);

  log.title('TOKEN CREADO');
  log.kv('Mint', artifact.mint);
  log.kv('Supply', `${tokenConfig.totalSupply.toLocaleString('es-ES')} (${artifact.totalSupply} unidades base)`);
  log.kv('Coste real', formatSol(artifact.costLamports));
  log.kv('Explorer', explorerUrl('address', artifact.mint, cluster));
  log.kv('Artefacto', paths.latest);

  log.title('SIGUIENTE');
  log.info('1. npm run metadata:build     (genera el JSON, §4.5)');
  log.info('2. npm run metadata:attach    (adjunta la metadata on-chain)');
  log.info('3. npm run verify:all         (comprobación pública completa)');
  log.warn('4. npm run authorities:revoke — IRREVERSIBLE. Solo cuando todo lo demás esté bien.');
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
